BEGIN;

ALTER TABLE public.whatsapp_outbox ADD COLUMN message_id text;
ALTER TABLE public.whatsapp_outbox ADD COLUMN delivered_at timestamptz;
CREATE UNIQUE INDEX whatsapp_outbox_message_idx ON public.whatsapp_outbox(shop_id,message_id) WHERE message_id IS NOT NULL;

CREATE FUNCTION public.supersede_whatsapp_notices() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  UPDATE public.whatsapp_outbox SET status='superseded',leased_until=NULL
    WHERE entry_id=NEW.entry_id AND id<>NEW.id AND status IN ('pending','sending');
  RETURN NEW;
END $$;
CREATE TRIGGER supersede_whatsapp_notices AFTER INSERT ON public.whatsapp_outbox
FOR EACH ROW EXECUTE FUNCTION public.supersede_whatsapp_notices();

CREATE FUNCTION public.claim_whatsapp_deliveries(p_shops uuid[], p_limit integer DEFAULT 1)
RETURNS SETOF public.whatsapp_outbox LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE item public.whatsapp_outbox; current_body text; customer public.queue_entries; barber text; ahead integer; place integer;
BEGIN
  UPDATE public.whatsapp_outbox o SET status='superseded',leased_until=NULL
  WHERE o.status IN ('pending','sending') AND o.shop_id=ANY(p_shops) AND (
    NOT EXISTS (SELECT 1 FROM public.queue_entries q WHERE q.id=o.entry_id AND
      ((q.status='waiting' AND o.kind IN ('welcome','progress','upcoming')) OR (q.status='serving' AND o.kind='chair')))
    OR EXISTS (SELECT 1 FROM public.whatsapp_outbox newer WHERE newer.entry_id=o.entry_id AND
      (newer.created_at,newer.id)>(o.created_at,o.id) AND newer.status<>'superseded'));
  FOR item IN SELECT o.* FROM public.whatsapp_outbox o WHERE o.shop_id=ANY(p_shops)
    AND ((o.status='pending' AND o.next_attempt_at<=now()) OR (o.status='sending' AND o.leased_until<now()))
    ORDER BY o.created_at FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(p_limit,1),10) LOOP
    SELECT * INTO customer FROM public.queue_entries WHERE id=item.entry_id;
    SELECT barber_name INTO barber FROM public.shops WHERE id=item.shop_id;
    IF customer.status='serving' THEN
      current_body := format('%s, ¡ya es tu turno con %s! Pasa al sillón.',customer.customer_name,barber);
    ELSE
      SELECT count(*)::int INTO ahead FROM public.queue_entries
        WHERE shop_id=item.shop_id AND (status='serving' OR (status='waiting' AND position<customer.position));
      SELECT count(*)::int+1 INTO place FROM public.queue_entries
        WHERE shop_id=item.shop_id AND status='waiting' AND position<customer.position;
      current_body := format('%s, estás en la fila de %s. %s antes de ti.%s Responde CANCELAR si no asistirás.',
        customer.customer_name,barber,
        CASE WHEN ahead=1 THEN 'Falta 1 persona' ELSE format('Faltan %s personas',ahead) END,
        CASE WHEN place<=2 THEN ' Casi es tu turno; ve acercándote a la barbería.' ELSE '' END);
    END IF;
    RETURN QUERY UPDATE public.whatsapp_outbox SET status='sending',attempts=attempts+1,
      leased_until=now()+interval '90 seconds',body=current_body,
      message_id=CASE WHEN message_id IS NULL OR body<>current_body THEN upper(replace(gen_random_uuid()::text,'-','')) ELSE message_id END
      WHERE id=item.id RETURNING *;
  END LOOP;
END $$;

CREATE FUNCTION public.finish_whatsapp_attempt(p_id uuid,p_message_id text,p_success boolean)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  UPDATE public.whatsapp_outbox SET
    status=CASE WHEN p_success THEN 'sending' ELSE 'pending' END,
    sent_at=CASE WHEN p_success THEN now() ELSE sent_at END,
    leased_until=CASE WHEN p_success THEN now()+interval '60 seconds' ELSE NULL END,
    next_attempt_at=now()+interval '30 seconds'
  WHERE id=p_id AND message_id=p_message_id AND status='sending';
END $$;

CREATE FUNCTION public.confirm_whatsapp_delivery(p_shop uuid,p_message_id text)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE item public.whatsapp_outbox;
BEGIN
  UPDATE public.whatsapp_outbox SET status='sent',delivered_at=now(),leased_until=NULL
    WHERE shop_id=p_shop AND message_id=p_message_id AND status IN ('pending','sending') RETURNING * INTO item;
  IF item.id IS NOT NULL THEN
    UPDATE public.queue_entries SET
      notified_turn=CASE WHEN item.kind='chair' THEN true ELSE notified_turn END,
      notified_upcoming=CASE WHEN item.kind IN ('progress','upcoming') THEN true ELSE notified_upcoming END
    WHERE id=item.entry_id;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.supersede_whatsapp_notices(),public.claim_whatsapp_deliveries(uuid[],integer),
  public.finish_whatsapp_attempt(uuid,text,boolean),public.confirm_whatsapp_delivery(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_deliveries(uuid[],integer),
  public.finish_whatsapp_attempt(uuid,text,boolean),public.confirm_whatsapp_delivery(uuid,text) TO service_role;
COMMIT;
