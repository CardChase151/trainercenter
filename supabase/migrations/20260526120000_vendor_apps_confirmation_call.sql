-- Per-event "scheduled confirmation call" timestamp on vendor_applications.
-- Stored UTC, displayed PST in the staff time-map UI. Used as a calling
-- worklist sort key on /staff/events/:id/timemap.
ALTER TABLE public.vendor_applications
  ADD COLUMN IF NOT EXISTS confirmation_call_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS vendor_applications_confirmation_call_at_idx
  ON public.vendor_applications (event_id, confirmation_call_at NULLS LAST);

COMMENT ON COLUMN public.vendor_applications.confirmation_call_at IS
  'When staff intends to call this vendor to confirm their participation. Nullable; null = not yet scheduled.';
