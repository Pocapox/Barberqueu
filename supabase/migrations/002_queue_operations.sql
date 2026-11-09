BEGIN;
ALTER TABLE public.queue_entries ADD COLUMN cancel_token_hash text
  CHECK (cancel_token_hash ~ '^[a-f0-9]{64}$');

CREATE FUNCTION public.join_queue(p_shop uuid, p_name text, p_phone text, p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE opened boolean; entry public.queue_entries;
BEGIN
  SELECT is_open INTO opened FROM public.shops WHERE id=p_shop FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOP_NOT_FOUND'; END IF;
  IF NOT opened THEN RAISE EXCEPTION 'SHOP_CLOSED'; END IF;
  IF p_token_hash IS NULL THEN RAISE EXCEPTION 'INVALID_TURN'; END IF;
  IF EXISTS (SELECT 1 FROM public.queue_entries WHERE shop_id=p_shop AND customer_phone=p_phone AND status IN ('waiting','serving'))
    THEN RAISE EXCEPTION 'DUPLICATE_TURN' USING ERRCODE='23505'; END IF;
  INSERT INTO public.queue_entries (shop_id,customer_name,customer_phone,cancel_token_hash)
    VALUES (p_shop,p_name,p_phone,p_token_hash) RETURNING * INTO entry;
  RETURN to_jsonb(entry);
END $$;

CREATE FUNCTION public.advance_queue(p_shop uuid, p_expected_serving uuid, p_expected_waiting uuid, p_finish text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE current_entry public.queue_entries; first_entry public.queue_entries; second_entry public.queue_entries;
BEGIN
  PERFORM 1 FROM public.shops WHERE id=p_shop FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOP_NOT_FOUND'; END IF;
  IF p_finish NOT IN ('completed','no_show') OR p_finish IS NULL THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  SELECT * INTO current_entry FROM public.queue_entries WHERE shop_id=p_shop AND status='serving' FOR UPDATE;
  SELECT * INTO first_entry FROM public.queue_entries WHERE shop_id=p_shop AND status='waiting' ORDER BY position LIMIT 1 FOR UPDATE;
  IF current_entry.id IS DISTINCT FROM p_expected_serving OR first_entry.id IS DISTINCT FROM p_expected_waiting
    THEN RAISE EXCEPTION 'QUEUE_CHANGED'; END IF;
  IF current_entry.id IS NOT NULL THEN
    UPDATE public.queue_entries SET status=p_finish WHERE id=current_entry.id;
  END IF;
  IF first_entry.id IS NOT NULL THEN
    UPDATE public.queue_entries SET status='serving' WHERE id=first_entry.id RETURNING * INTO first_entry;
  END IF;
  SELECT * INTO second_entry FROM public.queue_entries WHERE shop_id=p_shop AND status='waiting' ORDER BY position LIMIT 1;
  RETURN jsonb_build_object('serving', CASE WHEN first_entry.id IS NULL THEN NULL ELSE to_jsonb(first_entry) END,
    'upcoming', CASE WHEN second_entry.id IS NULL THEN NULL ELSE to_jsonb(second_entry) END);
END $$;

CREATE FUNCTION public.cancel_queue(p_shop uuid, p_id uuid, p_token_hash text)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.shops WHERE id=p_shop FOR UPDATE;
  UPDATE public.queue_entries SET status='cancelled' WHERE shop_id=p_shop AND id=p_id
    AND cancel_token_hash=p_token_hash AND status='waiting';
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_TURN'; END IF;
END $$;

CREATE FUNCTION public.cancel_queue_phone(p_shop uuid, p_phone text)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.shops WHERE id=p_shop FOR UPDATE;
  UPDATE public.queue_entries SET status='cancelled' WHERE shop_id=p_shop AND customer_phone=p_phone AND status='waiting';
END $$;

CREATE FUNCTION public.skip_queue(p_shop uuid, p_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.shops WHERE id=p_shop FOR UPDATE;
  UPDATE public.queue_entries SET status='no_show' WHERE shop_id=p_shop AND id=p_id AND status='waiting';
  IF NOT FOUND THEN RAISE EXCEPTION 'QUEUE_CHANGED'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.join_queue(uuid,text,text,text), public.advance_queue(uuid,uuid,uuid,text),
  public.cancel_queue(uuid,uuid,text), public.cancel_queue_phone(uuid,text), public.skip_queue(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_queue(uuid,text,text,text), public.advance_queue(uuid,uuid,uuid,text),
  public.cancel_queue(uuid,uuid,text), public.cancel_queue_phone(uuid,text), public.skip_queue(uuid,uuid) TO service_role;
COMMIT;
