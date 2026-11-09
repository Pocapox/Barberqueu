BEGIN;

CREATE UNIQUE INDEX idx_unique_active_phone_all_shops
  ON public.queue_entries (customer_phone)
  WHERE status IN ('waiting', 'serving');

COMMIT;
