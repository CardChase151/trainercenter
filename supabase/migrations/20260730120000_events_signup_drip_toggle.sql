-- Per-event vendor-recruiting drip toggle (2026-07-30)
-- When true (default), vendor-event-drip's "signup" track emails approved
-- partner vendors who have NOT yet applied, nudging them to apply for this
-- event. Flip false once the roster is full to stop the recruiting emails.
-- Does NOT affect the "lineup" prep-reminder track to already-approved vendors.
alter table public.events
  add column if not exists signup_drip_active boolean not null default true;

comment on column public.events.signup_drip_active is
  'Vendor recruiting drip toggle. true (default) = vendor-event-drip signup track nudges not-yet-applied approved partners to apply. false = stop recruiting emails for this event. Lineup/prep reminders are unaffected.';
