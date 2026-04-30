-- Add soft-cancel columns to events. Cancelled events keep their applications,
-- attendance, votes, and media intact (vs hard delete which cascade-nukes them).
-- Reminder cron jobs should filter `WHERE NOT cancelled` so a cancelled event
-- automatically stops future reminders without code changes.
ALTER TABLE public.events
  ADD COLUMN cancelled boolean NOT NULL DEFAULT false,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancellation_reason text;

CREATE INDEX events_cancelled_idx ON public.events(cancelled) WHERE cancelled = true;
