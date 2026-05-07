-- Vendor email dedup log + daily drip cron job.
--
-- Purpose:
-- The vendor-event-drip edge function fires emails to vendors as a Vendor Day
-- approaches: T-21, T-14, T-7, T-3, T-2, T-1 for both "still need to sign up"
-- and "you're approved, get hyped" tracks, plus a T-0 morning-of warm reminder
-- on the approved-for-event track.
--
-- Each (vendor, event, step_key) pair must only fire once. The UNIQUE
-- constraint on vendor_email_log is the dedup lock — the drip function inserts
-- a row before sending, and the unique violation is the "already sent" signal.

create table if not exists public.vendor_email_log (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  step_key text not null,
  sent_at timestamptz not null default now(),
  unique (vendor_id, event_id, step_key)
);

create index if not exists vendor_email_log_event_step_idx
  on public.vendor_email_log (event_id, step_key);

-- RLS: only service role writes. No anon access — this is internal bookkeeping.
alter table public.vendor_email_log enable row level security;
create policy vendor_email_log_admin_read on public.vendor_email_log
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

-- Daily cron: walks every upcoming Vendor Day event and fires the active drip
-- step on both tracks. Idempotent — re-running on the same day is a no-op
-- because the unique constraint on vendor_email_log catches duplicates.
--
-- Schedule: 15:00 UTC = 8am PDT / 7am PST. Morning Pacific is when the
-- "see you there" warmth lands best.
select cron.schedule(
  'vendor-event-drip-daily',
  '0 15 * * *',
  $$
  select net.http_post(
    url := 'https://tfneuzbhiqsdvnhhdfsw.supabase.co/functions/v1/vendor-event-drip',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmbmV1emJoaXFzZHZuaGhkZnN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2NzcwNTEsImV4cCI6MjA5MDI1MzA1MX0.L90y9Cy1QeSQLkql3O8gaHSbGNIQ-NXjIM6hdzFEVf0'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) as request_id;
  $$
);
