-- Opens, clicks and deliveries reported by Resend for mail sent from mysendz.com.
create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  resend_email_id text not null,
  event_type text not null,
  to_email text not null,
  subject text,
  link text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists email_events_dedupe on public.email_events (resend_email_id, event_type, occurred_at, coalesce(link, ''));
create index if not exists email_events_to_idx on public.email_events (lower(to_email), occurred_at desc);
create index if not exists email_events_time_idx on public.email_events (occurred_at desc);
alter table public.email_events enable row level security;
create policy email_events_admin_read on public.email_events
  for select using (public.is_admin(auth.uid()));
