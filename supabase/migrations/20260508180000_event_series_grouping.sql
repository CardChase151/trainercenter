-- Multi-day event grouping: when staff create a camp or any sequence of dates
-- in the EventModal, every date becomes a row in `events` so the calendar grid,
-- vendor system, and category filter all keep working without special cases.
-- The shared `series_id` lets us render "Day X of Y" on each row, edit the
-- whole series at once, and cascade cancel/delete when the camp is called off.
--
-- A null series_id means the event is a single one-off (or a recurring event
-- via the existing `recurrence` column). The two grouping models are
-- orthogonal: a series is a hand-picked list of dates, recurrence is an
-- algorithmic pattern. We never mix them on a single row.

ALTER TABLE public.events
  ADD COLUMN series_id uuid,
  ADD COLUMN series_position int;

-- Position is only meaningful when series_id is set.
ALTER TABLE public.events
  ADD CONSTRAINT events_series_position_requires_series
  CHECK ((series_id IS NULL AND series_position IS NULL)
      OR (series_id IS NOT NULL AND series_position IS NOT NULL AND series_position > 0));

-- Lookup by series for "edit entire series" / "cancel all days" flows.
CREATE INDEX events_series_id_idx ON public.events(series_id) WHERE series_id IS NOT NULL;
