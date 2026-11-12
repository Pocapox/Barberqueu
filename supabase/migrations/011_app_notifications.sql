BEGIN;
CREATE OR REPLACE FUNCTION public.join_queue(p_shop uuid,p_name text,p_phone text,p_token_hash text)
RETURNS jsonb LANGUAGE sql SET search_path='' AS $$ SELECT public.join_queue_base(p_shop,p_name,p_phone,p_token_hash) $$;
CREATE OR REPLACE FUNCTION public.advance_queue(p_shop uuid,p_expected_serving uuid,p_expected_waiting uuid,p_finish text)
RETURNS jsonb LANGUAGE sql SET search_path='' AS $$ SELECT public.advance_queue_base(p_shop,p_expected_serving,p_expected_waiting,p_finish) $$;
CREATE OR REPLACE FUNCTION public.cancel_queue(p_shop uuid,p_id uuid,p_token_hash text)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.shops WHERE id=p_shop FOR UPDATE;
 UPDATE public.queue_entries SET status='cancelled' WHERE shop_id=p_shop AND id=p_id AND cancel_token_hash=p_token_hash AND status IN ('waiting','serving');
 IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TURN'; END IF;
END $$;
DROP FUNCTION public.join_queue_consent(uuid,text,text,text,boolean);
DROP FUNCTION public.claim_whatsapp_deliveries(uuid[],integer);
DROP FUNCTION public.claim_whatsapp_outbox(integer);
DROP FUNCTION public.finish_whatsapp_outbox(uuid,boolean);
DROP FUNCTION public.finish_whatsapp_attempt(uuid,text,boolean);
DROP FUNCTION public.confirm_whatsapp_delivery(uuid,text);
DROP TABLE public.whatsapp_outbox;
DROP TABLE public.whatsapp_sessions;
DROP FUNCTION public.filter_whatsapp_notice();
DROP FUNCTION public.supersede_whatsapp_notices();
ALTER TABLE public.queue_entries DROP COLUMN whatsapp_consent;

CREATE TABLE public.push_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
 entry_id uuid REFERENCES public.queue_entries(id) ON DELETE CASCADE,
 endpoint text NOT NULL CHECK(length(endpoint)<2048),
 p256dh text NOT NULL, auth text NOT NULL,
 expires_at timestamptz NOT NULL,
 UNIQUE NULLS NOT DISTINCT(endpoint,shop_id,entry_id)
);
CREATE TABLE public.push_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 subscription_id uuid NOT NULL REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
 entry_id uuid NOT NULL REFERENCES public.queue_entries(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('serving','upcoming','joined','cancelled')),
 title text NOT NULL, body text NOT NULL, url text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','expired')),
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes',
 UNIQUE(subscription_id,entry_id,kind)
);
CREATE INDEX push_jobs_due ON public.push_jobs(next_attempt_at) WHERE status IN ('pending','sending');
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions,public.push_jobs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.push_subscriptions,public.push_jobs TO service_role;

CREATE FUNCTION public.enqueue_app_notifications() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE barber text;
BEGIN
 IF TG_OP='UPDATE' AND NEW.status=OLD.status THEN RETURN NEW; END IF;
 SELECT barber_name INTO barber FROM public.shops WHERE id=NEW.shop_id;
 IF TG_OP='INSERT' OR NEW.status='cancelled' THEN
  INSERT INTO public.push_jobs(subscription_id,entry_id,kind,title,body,url)
  SELECT s.id,NEW.id,CASE WHEN TG_OP='INSERT' THEN 'joined' ELSE 'cancelled' END,barber,
   CASE WHEN TG_OP='INSERT' THEN 'Un cliente se unió a tu fila.' ELSE 'Un cliente canceló su turno.' END,'/admin'
  FROM public.push_subscriptions s WHERE s.shop_id=NEW.shop_id AND s.entry_id IS NULL AND s.expires_at>now()
  ON CONFLICT DO NOTHING;
 END IF;
 IF NEW.status='serving' THEN
  INSERT INTO public.push_jobs(subscription_id,entry_id,kind,title,body,url)
  SELECT s.id,NEW.id,'serving',barber,'Es tu turno. Acércate al sillón.','/?barber='||NEW.shop_id
  FROM public.push_subscriptions s WHERE s.entry_id=NEW.id AND s.expires_at>now() ON CONFLICT DO NOTHING;
 END IF;
 INSERT INTO public.push_jobs(subscription_id,entry_id,kind,title,body,url)
 SELECT s.id,q.id,'upcoming',barber,'Casi es tu turno. Estás entre los dos siguientes; ve acercándote.','/?barber='||NEW.shop_id
 FROM (SELECT id FROM public.queue_entries WHERE shop_id=NEW.shop_id AND status='waiting' ORDER BY position LIMIT 2) q
 JOIN public.push_subscriptions s ON s.entry_id=q.id WHERE s.expires_at>now() ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER app_queue_notifications AFTER INSERT OR UPDATE OF status ON public.queue_entries
 FOR EACH ROW EXECUTE FUNCTION public.enqueue_app_notifications();

CREATE FUNCTION public.claim_push_jobs() RETURNS SETOF public.push_jobs LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 DELETE FROM public.push_subscriptions WHERE expires_at<now();
 DELETE FROM public.push_jobs WHERE expires_at<now()-interval '1 day';
 UPDATE public.push_jobs j SET status='expired' WHERE status IN ('pending','sending') AND
  (expires_at<=now() OR attempts>=5 OR NOT EXISTS(SELECT 1 FROM public.queue_entries q WHERE q.id=j.entry_id AND
    ((j.kind='serving' AND q.status='serving') OR (j.kind='upcoming' AND q.status='waiting') OR j.kind IN ('joined','cancelled'))));
 RETURN QUERY WITH picked AS (
  SELECT id FROM public.push_jobs WHERE status IN ('pending','sending') AND next_attempt_at<=now()
  ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 10
 ) UPDATE public.push_jobs j SET status='sending',attempts=attempts+1,next_attempt_at=now()+interval '45 seconds'
 FROM picked WHERE j.id=picked.id RETURNING j.*;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_app_notifications(),public.claim_push_jobs() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_jobs() TO service_role;
CREATE FUNCTION public.revoke_barber_push() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.pin_hash IS DISTINCT FROM OLD.pin_hash THEN
  DELETE FROM public.push_subscriptions WHERE shop_id=OLD.shop_id AND entry_id IS NULL;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER revoke_barber_push AFTER DELETE OR UPDATE OF pin_hash ON public.barber_accounts
 FOR EACH ROW EXECUTE FUNCTION public.revoke_barber_push();
REVOKE ALL ON FUNCTION public.revoke_barber_push() FROM PUBLIC,anon,authenticated;
COMMIT;
