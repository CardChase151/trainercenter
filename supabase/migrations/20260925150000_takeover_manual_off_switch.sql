-- Manual off switch for the event-day home takeover.
-- Holds the event id whose takeover staff have suppressed. Because it stores
-- an id rather than a boolean, it self-clears: the next event has a different
-- id, so the takeover comes back on its own.
alter table public.site_settings
  add column if not exists takeover_off_event_id uuid references public.events(id) on delete set null;

comment on column public.site_settings.takeover_off_event_id is
  'Event whose home-page takeover is manually suppressed. Check-in, voting and vendor flows are unaffected.';
