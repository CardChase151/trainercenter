-- Vendor self-service opt-out + cancellation.
--
-- Two new vendor_applications.status values let vendors take themselves out
-- of the drip cycle for a specific event:
--
--   not_interested    Vendor said "don't bug me about this date" without
--                     ever applying. Behavior parity with no application:
--                     they don't show up in approved/pending counts, but
--                     they DO have a row so the signup-track drip filter
--                     (which excludes any vendor with a row for this event)
--                     naturally skips them.
--
--   vendor_cancelled  Vendor was approved for the event and then cancelled.
--                     Lineup-track drip filter (status = 'approved')
--                     naturally skips them. Staff notified separately.
--
-- Both transitions are vendor-initiated; the existing "Vendors can cancel
-- own applications" RLS policy already grants the necessary UPDATE/INSERT
-- access via is_vendor_owner().
--
-- 'cancelled' (existing) keeps its current meaning: staff-initiated
-- cancellation, including the suspended-vendor cascade.

ALTER TABLE public.vendor_applications
  DROP CONSTRAINT IF EXISTS vendor_applications_status_check;

ALTER TABLE public.vendor_applications
  ADD CONSTRAINT vendor_applications_status_check
  CHECK (status IN (
    'pending',
    'approved',
    'declined',
    'cancelled',
    'not_interested',
    'vendor_cancelled'
  ));
