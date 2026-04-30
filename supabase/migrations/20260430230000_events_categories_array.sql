-- Replace events.category (text) with events.categories (text[]) so a single
-- calendar event can be tagged with multiple things (Trade Night + Tournament,
-- Vendor Day + Trade Night, etc.). Backfill from existing values.

ALTER TABLE public.events ADD COLUMN categories text[] NOT NULL DEFAULT ARRAY['other'];

UPDATE public.events
SET categories = CASE WHEN category IS NULL THEN ARRAY['other'] ELSE ARRAY[category] END;

CREATE INDEX events_categories_idx ON public.events USING gin (categories);

ALTER TABLE public.events DROP COLUMN category;

CREATE OR REPLACE FUNCTION public.get_last_voted_vendor_day()
RETURNS TABLE (event_id uuid, event_title text, event_date date)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT e.id, e.title, e.event_date
  FROM public.events e
  WHERE e.categories @> ARRAY['vendor_day']
    AND e.event_date < CURRENT_DATE
    AND EXISTS (SELECT 1 FROM public.member_votes mv WHERE mv.event_id = e.id)
  ORDER BY e.event_date DESC
  LIMIT 1;
$$;
