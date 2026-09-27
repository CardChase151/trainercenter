-- 'incomplete' = applied for a paid date but has not saved a card yet.
--
-- The signup flow started writing this status on 2026-09-26 ("An application
-- with a fee is not an application until the card is saved") but the check
-- constraint was never widened, so every paid-table application died on
-- insert with vendor_applications_status_check.
--
-- Staff queues filter status = 'pending', so an incomplete row correctly
-- stays out of the roster until the card lands, at which point the card-save
-- paths (stripe-vendor-payment confirm_setup, stripe-vendor-webhook saveCard)
-- promote it to 'pending'.

ALTER TABLE public.vendor_applications
  DROP CONSTRAINT IF EXISTS vendor_applications_status_check;

ALTER TABLE public.vendor_applications
  ADD CONSTRAINT vendor_applications_status_check
  CHECK (status IN (
    'pending',
    'incomplete',
    'approved',
    'declined',
    'cancelled',
    'not_interested',
    'vendor_cancelled'
  ));
