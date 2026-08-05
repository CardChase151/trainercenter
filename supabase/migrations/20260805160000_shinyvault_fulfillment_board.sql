-- Camera-verified fulfillment workflow.
--
-- Packing happens on camera so the shop can defend chargebacks. That only works
-- if the database timestamps line up with the footage, so each physical step
-- records when it happened, not just that it happened.
--
-- Two distinct sources of truth, deliberately kept apart:
--   staff taps   -> label_printed_at, sealed_at, shipped_at  (things only a
--                   human in the room knows)
--   carrier says -> delivered_at, carrier_status             (Shippo tracking
--                   webhook; nobody taps these)
-- "Staff dropped it off" and "the carrier actually scanned it" are different
-- facts and get different columns. The customer-facing status should follow the
-- carrier, not the tap.

ALTER TABLE public.orders
  -- FIRST print only. Never overwritten by a reprint — this is the anchor used
  -- to scrub the camera footage to the moment this order was packed.
  ADD COLUMN IF NOT EXISTS label_printed_at timestamptz,
  -- Reprints move this and bump the count but leave the anchor alone. A reprint
  -- after sealed_at is a signal something went wrong and is worth seeing.
  ADD COLUMN IF NOT EXISTS label_last_printed_at timestamptz,
  ADD COLUMN IF NOT EXISTS label_print_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sealed_at timestamptz,
  -- Staff handed it to the carrier. NOT the same as the carrier scanning it.
  ADD COLUMN IF NOT EXISTS shipped_at timestamptz,
  -- Carrier-reported. Set by the Shippo tracking webhook, never by a person.
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  -- Raw Shippo tracking_status.status (PRE_TRANSIT / TRANSIT / DELIVERED /
  -- RETURNED / FAILURE / UNKNOWN) so the board can show real carrier state
  -- without re-querying Shippo.
  ADD COLUMN IF NOT EXISTS carrier_status text,
  -- Who packed it. With one person this is noise; with two it is the difference
  -- between finding the right 30 seconds of footage and scrubbing four hours.
  ADD COLUMN IF NOT EXISTS handled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Expand the fulfillment_status vocabulary for the new lanes. The original
-- 6-value CHECK is in 20260714120000_shinyvault_commerce.sql.
--   ship:   unfulfilled -> label_purchased -> printed -> sealed -> shipped -> delivered -> completed
--   pickup: unfulfilled -> ready_for_pickup -> picked_up -> completed
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_fulfillment_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_fulfillment_status_check
  CHECK (fulfillment_status IN (
    'unfulfilled', 'label_purchased', 'printed', 'sealed', 'shipped',
    'delivered', 'ready_for_pickup', 'picked_up', 'completed'
  ));

-- The board queries open work constantly. Partial index keeps it small, since
-- finished orders come to dominate the table over time.
CREATE INDEX IF NOT EXISTS orders_open_fulfillment_idx
  ON public.orders (fulfillment_status, created_at DESC)
  WHERE payment_status = 'paid'
    AND fulfillment_status NOT IN ('completed', 'picked_up', 'delivered');

-- shinyvault-track-webhook looks orders up by tracking number on every carrier
-- scan, which is several events per parcel.
CREATE INDEX IF NOT EXISTS orders_tracking_number_idx
  ON public.orders (tracking_number)
  WHERE tracking_number IS NOT NULL;
