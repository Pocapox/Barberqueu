BEGIN;

CREATE TABLE public.shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (length(btrim(slug)) > 0),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  barber_name text NOT NULL CHECK (length(btrim(barber_name)) > 0),
  avg_cut_minutes integer NOT NULL DEFAULT 25 CHECK (avg_cut_minutes > 0),
  is_open boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.shops (id, slug, name, barber_name)
VALUES ('00000000-0000-0000-0000-000000000001', 'principal', 'Barbería Principal', 'Barbero Principal');

CREATE TABLE public.queue_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  customer_name text NOT NULL CHECK (length(btrim(customer_name)) BETWEEN 1 AND 80),
  customer_phone text NOT NULL CHECK (customer_phone ~ '^[1-9][0-9]{7,14}$'),
  position integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  status text NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'serving', 'completed', 'cancelled', 'no_show')),
  notified_turn boolean NOT NULL DEFAULT false,
  notified_upcoming boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_unique_active_phone_per_shop
  ON public.queue_entries (shop_id, customer_phone)
  WHERE status IN ('waiting', 'serving');

CREATE UNIQUE INDEX idx_unique_serving_per_shop
  ON public.queue_entries (shop_id)
  WHERE status = 'serving';

CREATE INDEX idx_queue_active_lookup ON public.queue_entries (shop_id, status, position);

CREATE TABLE public.whatsapp_sessions (
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  key_id text NOT NULL CHECK (length(key_id) > 0),
  data text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, key_id)
);

CREATE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER queue_entries_updated_at BEFORE UPDATE ON public.queue_entries
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER whatsapp_sessions_updated_at BEFORE UPDATE ON public.whatsapp_sessions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;

-- Remove Supabase default grants, including TRUNCATE (which bypasses RLS).
REVOKE ALL ON public.shops, public.queue_entries, public.whatsapp_sessions
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.queue_entries_position_seq FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.shops TO anon, authenticated;
-- Explicit column grants protect phone numbers in REST and Realtime.
-- Consumers must select these columns explicitly instead of SELECT *.
GRANT SELECT (id, shop_id, customer_name, position, status, notified_turn,
  notified_upcoming, created_at, updated_at) ON public.queue_entries TO anon, authenticated;

CREATE POLICY public_read_shops ON public.shops FOR SELECT
  TO anon, authenticated USING (true);
-- Keep terminal-state metadata readable so Realtime can deliver completion and
-- cancellation transitions. Clients filter active rows for the visible queue.
CREATE POLICY public_read_queue_metadata ON public.queue_entries FOR SELECT
  TO anon, authenticated USING (true);

-- whatsapp_sessions has no public policies or privileges.
GRANT ALL ON public.shops, public.queue_entries, public.whatsapp_sessions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.queue_entries_position_seq TO service_role;

-- Supabase provides this publication. Auth credentials must never be published.
ALTER PUBLICATION supabase_realtime ADD TABLE public.shops, public.queue_entries;

COMMIT;
