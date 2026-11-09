BEGIN;

CREATE OR REPLACE FUNCTION public.create_barber_shop(p_parent_shop uuid, p_name text, p_pin_hash text, p_pin_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE new_id uuid := gen_random_uuid(); parent public.shops;
BEGIN
  SELECT * INTO parent FROM public.shops WHERE id = p_parent_shop FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOP_NOT_FOUND'; END IF;
  IF length(btrim(p_name)) NOT BETWEEN 1 AND 80 OR p_pin_hash !~ '^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$'
    OR p_pin_fingerprint !~ '^[a-f0-9]{64}$'
    THEN RAISE EXCEPTION 'INVALID_BARBER'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.barber_accounts WHERE shop_id = p_parent_shop) THEN
    INSERT INTO public.barber_accounts (shop_id, name, pin_hash, pin_fingerprint)
      VALUES (p_parent_shop, btrim(p_name), p_pin_hash, p_pin_fingerprint);
    UPDATE public.shops SET barber_name = btrim(p_name) WHERE id = p_parent_shop;
    RETURN jsonb_build_object('id', p_parent_shop, 'name', btrim(p_name));
  END IF;
  INSERT INTO public.shops (id, slug, name, barber_name, avg_cut_minutes)
    VALUES (new_id, 'barber-' || replace(new_id::text, '-', ''), parent.name, btrim(p_name), parent.avg_cut_minutes);
  INSERT INTO public.barber_accounts (shop_id, name, pin_hash, pin_fingerprint)
    VALUES (new_id, btrim(p_name), p_pin_hash, p_pin_fingerprint);
  RETURN jsonb_build_object('id', new_id, 'name', btrim(p_name));
END $$;

COMMIT;
