BEGIN;

CREATE TABLE public.whatsapp_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES public.queue_entries(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('welcome','chair','progress','upcoming')),
  phone text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','superseded')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  leased_until timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_outbox_pending_idx ON public.whatsapp_outbox(next_attempt_at,created_at) WHERE status IN ('pending','sending');
ALTER TABLE public.whatsapp_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.whatsapp_outbox TO service_role;

ALTER FUNCTION public.join_queue(uuid,text,text,text) RENAME TO join_queue_base;
CREATE FUNCTION public.join_queue(p_shop uuid, p_name text, p_phone text, p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE entry jsonb; barber text;
BEGIN
  entry := public.join_queue_base(p_shop,p_name,p_phone,p_token_hash);
  SELECT barber_name INTO barber FROM public.shops WHERE id=p_shop;
  INSERT INTO public.whatsapp_outbox(shop_id,entry_id,kind,phone,body)
  VALUES (p_shop,(entry->>'id')::uuid,'welcome',p_phone,
    format('%s, ya estás en la fila de %s. Te avisaremos cuando se acerque tu turno. Responde CANCELAR si no asistirás.',p_name,barber));
  RETURN entry;
END $$;

ALTER FUNCTION public.advance_queue(uuid,uuid,uuid,text) RENAME TO advance_queue_base;
CREATE FUNCTION public.advance_queue(p_shop uuid, p_expected_serving uuid, p_expected_waiting uuid, p_finish text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE result jsonb; barber text; serving_id uuid; item record; ahead integer;
BEGIN
  result := public.advance_queue_base(p_shop,p_expected_serving,p_expected_waiting,p_finish);
  SELECT barber_name INTO barber FROM public.shops WHERE id=p_shop;
  serving_id := (result->'serving'->>'id')::uuid;
  IF serving_id IS NOT NULL THEN
    UPDATE public.whatsapp_outbox SET status='superseded' WHERE entry_id=serving_id AND status='pending';
    INSERT INTO public.whatsapp_outbox(shop_id,entry_id,kind,phone,body)
    SELECT p_shop,id,'chair',customer_phone,
      format('%s, ¡ya es tu turno con %s! Pasa al sillón.',customer_name,barber)
    FROM public.queue_entries WHERE id=serving_id;
  END IF;
  FOR item IN SELECT id,customer_name,customer_phone,notified_upcoming,
      row_number() OVER (ORDER BY position) AS place
    FROM public.queue_entries WHERE shop_id=p_shop AND status='waiting' ORDER BY position LOOP
    IF p_finish='completed' AND p_expected_serving IS NOT NULL THEN
      ahead := item.place + CASE WHEN serving_id IS NULL THEN 0 ELSE 1 END;
      UPDATE public.whatsapp_outbox SET status='superseded'
        WHERE entry_id=item.id AND kind IN ('welcome','progress','upcoming') AND status='pending';
      INSERT INTO public.whatsapp_outbox(shop_id,entry_id,kind,phone,body)
      VALUES (p_shop,item.id,'progress',item.customer_phone,
        format('%s, la fila de %s avanzó. %s antes de ti.%s Responde CANCELAR si no asistirás.',
          item.customer_name,barber,
          CASE WHEN ahead=1 THEN 'Falta 1 persona' ELSE format('Faltan %s personas',ahead) END,
          CASE WHEN item.place <= 2 THEN ' Casi es tu turno; ve acercándote a la barbería.' ELSE '' END));
    ELSIF item.place <= 2 AND NOT item.notified_upcoming THEN
      UPDATE public.whatsapp_outbox SET status='superseded'
        WHERE entry_id=item.id AND kind='welcome' AND status='pending';
      INSERT INTO public.whatsapp_outbox(shop_id,entry_id,kind,phone,body)
      VALUES (p_shop,item.id,'upcoming',item.customer_phone,
        format('%s, casi es tu turno con %s. Ve acercándote a la barbería. Responde CANCELAR si no asistirás.',item.customer_name,barber));
    END IF;
  END LOOP;
  RETURN result;
END $$;

CREATE FUNCTION public.claim_whatsapp_outbox(p_limit integer DEFAULT 10)
RETURNS SETOF public.whatsapp_outbox LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RETURN QUERY WITH picked AS (
    SELECT o.id FROM public.whatsapp_outbox o JOIN public.queue_entries q ON q.id=o.entry_id
    WHERE ((o.status='pending' AND o.next_attempt_at <= now()) OR (o.status='sending' AND o.leased_until < now()))
      AND ((o.kind IN ('welcome','progress','upcoming') AND q.status='waiting') OR (o.kind='chair' AND q.status='serving'))
    ORDER BY o.created_at FOR UPDATE OF o SKIP LOCKED LIMIT LEAST(GREATEST(p_limit,1),20)
  )
  UPDATE public.whatsapp_outbox o SET status='sending',leased_until=now()+interval '90 seconds',attempts=attempts+1
  FROM picked WHERE o.id=picked.id RETURNING o.*;
END $$;

CREATE FUNCTION public.finish_whatsapp_outbox(p_id uuid, p_success boolean)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE item public.whatsapp_outbox;
BEGIN
  UPDATE public.whatsapp_outbox SET
    status=CASE WHEN p_success THEN 'sent' ELSE 'pending' END,
    sent_at=CASE WHEN p_success THEN now() ELSE NULL END,
    leased_until=NULL,
    next_attempt_at=CASE WHEN p_success THEN now() ELSE now()+make_interval(secs => LEAST(300,5*power(2,LEAST(attempts,6))::integer)) END
  WHERE id=p_id AND status='sending' RETURNING * INTO item;
  IF item.id IS NOT NULL AND p_success THEN
    UPDATE public.queue_entries SET
      notified_turn=CASE WHEN item.kind='chair' THEN true ELSE notified_turn END,
      notified_upcoming=CASE WHEN item.kind IN ('progress','upcoming') THEN true ELSE notified_upcoming END
    WHERE id=item.entry_id;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.join_queue(uuid,text,text,text), public.advance_queue(uuid,uuid,uuid,text),
  public.join_queue_base(uuid,text,text,text), public.advance_queue_base(uuid,uuid,uuid,text),
  public.claim_whatsapp_outbox(integer), public.finish_whatsapp_outbox(uuid,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_queue(uuid,text,text,text), public.advance_queue(uuid,uuid,uuid,text),
  public.claim_whatsapp_outbox(integer), public.finish_whatsapp_outbox(uuid,boolean) TO service_role;
COMMIT;
