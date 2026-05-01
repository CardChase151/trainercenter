-- Replace the 'vendor_day' category with first-class vendor fields on events.
-- Any event (trade night, big event, tournament, anything) can now opt into
-- having vendors. Vendor times can differ from event times (e.g. event 8am-10pm,
-- vendors only 6pm-10pm). The optional vendor_note is staff-authored and only
-- shown to vendors (in emails / dashboards), never to public visitors.
ALTER TABLE public.events
  ADD COLUMN has_vendors boolean NOT NULL DEFAULT false,
  ADD COLUMN vendor_start_time time,
  ADD COLUMN vendor_end_time time,
  ADD COLUMN vendor_note text;

-- Backfill: every event currently tagged vendor_day becomes has_vendors=true.
-- Vendor times default to the event times (staff can override per event later).
UPDATE public.events
SET has_vendors = true,
    vendor_start_time = start_time,
    vendor_end_time = end_time
WHERE 'vendor_day' = ANY(categories);

-- Strip 'vendor_day' from existing categories arrays so it stops surfacing as
-- a category chip / filter color anywhere in the UI.
UPDATE public.events
SET categories = array_remove(categories, 'vendor_day')
WHERE 'vendor_day' = ANY(categories);

-- Backfill safety: any rows that ended up with empty categories[] after the
-- strip should fall back to 'other' so the UI never sees a 0-length array.
UPDATE public.events
SET categories = ARRAY['other']
WHERE cardinality(categories) = 0;

CREATE INDEX events_has_vendors_idx ON public.events(has_vendors) WHERE has_vendors = true;

-- The legacy RPC filtered by categories @> ['vendor_day']; switch to the new
-- has_vendors flag so it keeps returning the right "last voted" event.
CREATE OR REPLACE FUNCTION public.get_last_voted_vendor_day()
RETURNS TABLE (event_id uuid, event_title text, event_date date)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT e.id, e.title, e.event_date
  FROM public.events e
  WHERE e.has_vendors = true
    AND e.event_date < CURRENT_DATE
    AND EXISTS (SELECT 1 FROM public.member_votes mv WHERE mv.event_id = e.id)
  ORDER BY e.event_date DESC
  LIMIT 1;
$$;
