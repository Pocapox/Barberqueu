BEGIN;
ALTER TABLE public.queue_entries ADD COLUMN whatsapp_consent boolean NOT NULL DEFAULT false;
CREATE FUNCTION public.filter_whatsapp_notice() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE customer public.queue_entries; place integer;
BEGIN
 SELECT * INTO customer FROM public.queue_entries WHERE id=NEW.entry_id;
 IF NOT customer.whatsapp_consent OR customer.status NOT IN ('waiting','serving') THEN RETURN NULL; END IF;
 IF NEW.kind IN ('progress','upcoming') THEN
   SELECT count(*)+1 INTO place FROM public.queue_entries WHERE shop_id=NEW.shop_id AND status='waiting' AND position<customer.position;
   IF place>2 OR EXISTS(SELECT 1 FROM public.whatsapp_outbox WHERE entry_id=NEW.entry_id AND kind IN ('progress','upcoming')) THEN RETURN NULL; END IF;
   NEW.kind := 'upcoming';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER filter_whatsapp_notice BEFORE INSERT ON public.whatsapp_outbox FOR EACH ROW EXECUTE FUNCTION public.filter_whatsapp_notice();
CREATE OR REPLACE FUNCTION public.advance_queue(p_shop uuid,p_expected_serving uuid,p_expected_waiting uuid,p_finish text)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE result jsonb; item public.queue_entries;
BEGIN
 result := public.advance_queue_base(p_shop,p_expected_serving,p_expected_waiting,p_finish);
 IF result->'serving'->>'id' IS NOT NULL THEN
  INSERT INTO public.whatsapp_outbox(shop_id,entry_id,kind,phone,body)
  SELECT shop_id,id,'chair',customer_phone,'Tu turno está listo.' FROM public.queue_entries WHERE id=(result->'serving'->>'id')::uuid;
 END IF;
 FOR item IN SELECT * FROM public.queue_entries WHERE shop_id=p_shop AND status='waiting' ORDER BY position LIMIT 2 LOOP
  INSERT INTO public.whatsapp_outbox(shop_id,entry_id,kind,phone,body) VALUES(p_shop,item.id,'upcoming',item.customer_phone,'Casi es tu turno.');
 END LOOP;
 RETURN result;
END $$;
CREATE FUNCTION public.join_queue_consent(p_shop uuid,p_name text,p_phone text,p_token_hash text,p_consent boolean)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE entry jsonb; barber text;
BEGIN
 entry := public.join_queue_base(p_shop,p_name,p_phone,p_token_hash);
 UPDATE public.queue_entries SET whatsapp_consent=p_consent WHERE id=(entry->>'id')::uuid;
 SELECT barber_name INTO barber FROM public.shops WHERE id=p_shop;
 IF p_consent THEN INSERT INTO public.whatsapp_outbox(shop_id,entry_id,kind,phone,body) VALUES(p_shop,(entry->>'id')::uuid,'welcome',p_phone,format('%s, tu turno con %s está registrado. Responde PARAR para detener avisos o CANCELAR para cancelar el turno.',p_name,barber)); END IF;
 RETURN entry;
END $$;
CREATE OR REPLACE FUNCTION public.finish_whatsapp_attempt(p_id uuid,p_message_id text,p_success boolean)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 UPDATE public.whatsapp_outbox SET
 status=CASE WHEN p_success THEN 'sending' WHEN attempts>=3 THEN 'superseded' ELSE 'pending' END,
 sent_at=CASE WHEN p_success THEN now() ELSE sent_at END,
 leased_until=CASE WHEN p_success THEN now()+interval '100 years' ELSE NULL END,
 next_attempt_at=now()+make_interval(secs=>LEAST(900,60*power(2,LEAST(attempts,4))::int))
 WHERE id=p_id AND message_id=p_message_id AND status='sending';
END $$;
UPDATE public.whatsapp_outbox SET status='superseded',leased_until=NULL WHERE status IN ('pending','sending');
REVOKE ALL ON FUNCTION public.filter_whatsapp_notice(),public.join_queue_consent(uuid,text,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.join_queue_consent(uuid,text,text,text,boolean) TO service_role;
COMMIT;
