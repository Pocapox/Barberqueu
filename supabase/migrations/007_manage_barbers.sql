BEGIN;

ALTER TABLE public.shops ADD COLUMN archived_at timestamptz;

CREATE OR REPLACE FUNCTION public.join_queue(p_shop uuid, p_name text, p_phone text, p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE opened boolean; archived timestamptz; entry public.queue_entries;
BEGIN
  SELECT is_open, archived_at INTO opened, archived FROM public.shops WHERE id=p_shop FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOP_NOT_FOUND'; END IF;
  IF NOT opened OR archived IS NOT NULL THEN RAISE EXCEPTION 'SHOP_CLOSED'; END IF;
  IF p_token_hash IS NULL THEN RAISE EXCEPTION 'INVALID_TURN'; END IF;
  IF EXISTS (SELECT 1 FROM public.queue_entries WHERE shop_id=p_shop AND customer_phone=p_phone AND status IN ('waiting','serving'))
    THEN RAISE EXCEPTION 'DUPLICATE_TURN' USING ERRCODE='23505'; END IF;
  INSERT INTO public.queue_entries (shop_id,customer_name,customer_phone,cancel_token_hash)
    VALUES (p_shop,p_name,p_phone,p_token_hash) RETURNING * INTO entry;
  RETURN to_jsonb(entry);
END $$;

CREATE FUNCTION public.update_barber_account(p_shop uuid, p_name text, p_pin_hash text, p_pin_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE existing public.barber_accounts;
BEGIN
  PERFORM 1 FROM public.shops WHERE id=p_shop AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BARBER_NOT_FOUND'; END IF;
  SELECT * INTO existing FROM public.barber_accounts WHERE shop_id=p_shop FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BARBER_NOT_FOUND'; END IF;
  IF length(btrim(p_name)) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'INVALID_BARBER'; END IF;
  IF (p_pin_hash IS NULL) IS DISTINCT FROM (p_pin_fingerprint IS NULL) THEN RAISE EXCEPTION 'INVALID_BARBER'; END IF;
  IF p_pin_hash IS NOT NULL AND (p_pin_hash !~ '^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$' OR p_pin_fingerprint !~ '^[a-f0-9]{64}$')
    THEN RAISE EXCEPTION 'INVALID_BARBER'; END IF;
  UPDATE public.barber_accounts SET name=btrim(p_name),
    pin_hash=coalesce(p_pin_hash, existing.pin_hash),
    pin_fingerprint=coalesce(p_pin_fingerprint, existing.pin_fingerprint)
    WHERE shop_id=p_shop;
  UPDATE public.shops SET barber_name=btrim(p_name) WHERE id=p_shop;
  RETURN jsonb_build_object('id', p_shop, 'name', btrim(p_name));
END $$;

CREATE FUNCTION public.archive_barber_account(p_shop uuid, p_primary_shop uuid)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.shops WHERE id=p_shop AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.barber_accounts WHERE shop_id=p_shop)
    THEN RAISE EXCEPTION 'BARBER_NOT_FOUND'; END IF;
  IF EXISTS (SELECT 1 FROM public.queue_entries WHERE shop_id=p_shop AND status IN ('waiting','serving'))
    THEN RAISE EXCEPTION 'BARBER_HAS_ACTIVE_TURNS'; END IF;
  DELETE FROM public.barber_accounts WHERE shop_id=p_shop;
  IF p_shop=p_primary_shop THEN
    UPDATE public.shops SET barber_name='Barbero Principal' WHERE id=p_shop;
  ELSE
    UPDATE public.shops SET is_open=false, archived_at=now() WHERE id=p_shop;
  END IF;
END $$;

CREATE FUNCTION public.cancel_queue_phone_details(p_phone text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE names jsonb;
BEGIN
  WITH cancelled AS (
    UPDATE public.queue_entries SET status='cancelled'
      WHERE customer_phone=p_phone AND status='waiting'
      RETURNING shop_id
  )
  SELECT coalesce(jsonb_agg(DISTINCT s.barber_name), '[]'::jsonb) INTO names
    FROM cancelled c JOIN public.shops s ON s.id=c.shop_id;
  RETURN names;
END $$;

REVOKE ALL ON FUNCTION public.update_barber_account(uuid,text,text,text),
  public.archive_barber_account(uuid,uuid), public.cancel_queue_phone_details(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_barber_account(uuid,text,text,text),
  public.archive_barber_account(uuid,uuid), public.cancel_queue_phone_details(text)
  TO service_role;

COMMIT;
