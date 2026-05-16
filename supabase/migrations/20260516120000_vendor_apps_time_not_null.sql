-- Lock down vendor_applications.requested_start_time/end_time so the
-- Time Map (and any future planning surface) can rely on every approved
-- vendor having a slot on file. Two parts:
--
-- 1. Backfill: 15 historical rows applied before these columns existed
--    are still NULL. Default each one to its event's vendor_start_time /
--    vendor_end_time (falling back to the event's overall start/end).
-- 2. NOT NULL: lock the columns so future inserts must supply both.
--
-- The UI (ApplyForEventModal in src/App.js) already enforces this on the
-- happy path; this migration is the belt-and-suspenders DB guarantee.

UPDATE public.vendor_applications va
SET
  requested_start_time = COALESCE(e.vendor_start_time, e.start_time),
  requested_end_time   = COALESCE(e.vendor_end_time,   e.end_time)
FROM public.events e
WHERE va.event_id = e.id
  AND (va.requested_start_time IS NULL OR va.requested_end_time IS NULL);

ALTER TABLE public.vendor_applications
  ALTER COLUMN requested_start_time SET NOT NULL,
  ALTER COLUMN requested_end_time   SET NOT NULL;
