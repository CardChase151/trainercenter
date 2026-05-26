-- Staff confirmation flag. Set by clicking "Confirmed" on the time-map
-- detail modal after a successful confirmation call (or other channel).
-- Null = not yet confirmed; timestamp = confirmed at that moment.
ALTER TABLE public.vendor_applications
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS vendor_applications_confirmed_at_idx
  ON public.vendor_applications (event_id, confirmed_at);

COMMENT ON COLUMN public.vendor_applications.confirmed_at IS
  'Set when staff has confirmed (by phone or otherwise) that the vendor will show up. Null = not yet confirmed.';
