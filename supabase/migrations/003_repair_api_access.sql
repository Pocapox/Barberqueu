BEGIN;

ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
REVOKE ALL ON public.shops, public.queue_entries, public.whatsapp_sessions
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.queue_entries_position_seq FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.shops TO anon, authenticated;
GRANT SELECT (id, shop_id, customer_name, position, status, notified_turn,
  notified_upcoming, created_at, updated_at)
  ON public.queue_entries TO anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='shops' AND policyname='public_read_shops') THEN
    CREATE POLICY public_read_shops ON public.shops FOR SELECT
      TO anon, authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='queue_entries' AND policyname='public_read_queue_metadata') THEN
    CREATE POLICY public_read_queue_metadata ON public.queue_entries FOR SELECT
      TO anon, authenticated USING (true);
  END IF;
END $$;

GRANT ALL ON public.shops, public.queue_entries, public.whatsapp_sessions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.queue_entries_position_seq TO service_role;

REVOKE ALL ON FUNCTION public.join_queue(uuid,text,text,text),
  public.advance_queue(uuid,uuid,uuid,text), public.cancel_queue(uuid,uuid,text),
  public.cancel_queue_phone(uuid,text), public.skip_queue(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_queue(uuid,text,text,text),
  public.advance_queue(uuid,uuid,uuid,text), public.cancel_queue(uuid,uuid,text),
  public.cancel_queue_phone(uuid,text), public.skip_queue(uuid,uuid)
  TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='shops') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.shops;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='queue_entries') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.queue_entries;
  END IF;
END $$;

COMMIT;
