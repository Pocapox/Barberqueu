BEGIN;

CREATE TABLE public.barber_accounts (
  shop_id uuid PRIMARY KEY REFERENCES public.shops(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  name_key text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
  pin_hash text NOT NULL CHECK (pin_hash ~ '^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$'),
  pin_fingerprint text NOT NULL UNIQUE CHECK (pin_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name_key)
);

ALTER TABLE public.barber_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.barber_accounts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.barber_accounts TO service_role;

CREATE FUNCTION public.create_barber_shop(p_parent_shop uuid, p_name text, p_pin_hash text, p_pin_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE new_id uuid := gen_random_uuid(); parent public.shops;
BEGIN
  SELECT * INTO parent FROM public.shops WHERE id = p_parent_shop;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOP_NOT_FOUND'; END IF;
  IF length(btrim(p_name)) NOT BETWEEN 1 AND 80 OR p_pin_hash !~ '^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$'
    OR p_pin_fingerprint !~ '^[a-f0-9]{64}$'
    THEN RAISE EXCEPTION 'INVALID_BARBER'; END IF;
  INSERT INTO public.shops (id, slug, name, barber_name, avg_cut_minutes)
    VALUES (new_id, 'barber-' || replace(new_id::text, '-', ''), parent.name, btrim(p_name), parent.avg_cut_minutes);
  INSERT INTO public.barber_accounts (shop_id, name, pin_hash, pin_fingerprint)
    VALUES (new_id, btrim(p_name), p_pin_hash, p_pin_fingerprint);
  RETURN jsonb_build_object('id', new_id, 'name', btrim(p_name));
END $$;

CREATE FUNCTION public.cancel_queue_phone_all(p_phone text)
RETURNS integer LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE changed integer;
BEGIN
  UPDATE public.queue_entries SET status = 'cancelled'
    WHERE customer_phone = p_phone AND status = 'waiting';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END $$;

REVOKE ALL ON FUNCTION public.create_barber_shop(uuid,text,text,text), public.cancel_queue_phone_all(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_barber_shop(uuid,text,text,text), public.cancel_queue_phone_all(text)
  TO service_role;

COMMIT;
