-- Campaign name on every tracked email event, plus admin-only summaries
-- that aggregate on the server (PostgREST caps plain selects at 1000 rows).
alter table public.email_events add column if not exists campaign text;
create index if not exists email_events_campaign_idx on public.email_events (coalesce(campaign, subject));

create or replace function public.email_campaigns_summary()
returns table (campaign text, subject text, first_at timestamptz, sent int, delivered int, opened int, clicked int, bounced int)
language sql security definer set search_path = public as $$
  select coalesce(e.campaign, e.subject) as campaign,
         max(e.subject) as subject,
         min(e.occurred_at) as first_at,
         count(distinct e.to_email) filter (where e.event_type in ('sent','delivered','bounced'))::int as sent,
         count(distinct e.to_email) filter (where e.event_type = 'delivered')::int as delivered,
         count(distinct e.to_email) filter (where e.event_type = 'opened')::int as opened,
         count(distinct e.to_email) filter (where e.event_type = 'clicked')::int as clicked,
         count(distinct e.to_email) filter (where e.event_type = 'bounced')::int as bounced
  from public.email_events e
  where public.is_admin(auth.uid())
  group by 1
  order by min(e.occurred_at) desc
$$;

create or replace function public.email_campaign_people(p_campaign text)
returns table (email text, delivered boolean, bounced boolean, opens int, clicks int, last_at timestamptz)
language sql security definer set search_path = public as $$
  select e.to_email,
         bool_or(e.event_type = 'delivered'),
         bool_or(e.event_type = 'bounced'),
         count(*) filter (where e.event_type = 'opened')::int,
         count(*) filter (where e.event_type = 'clicked')::int,
         max(e.occurred_at)
  from public.email_events e
  where public.is_admin(auth.uid()) and coalesce(e.campaign, e.subject) = p_campaign
  group by e.to_email
  order by 5 desc, 4 desc, 6 desc
$$;

grant execute on function public.email_campaigns_summary() to authenticated;
grant execute on function public.email_campaign_people(text) to authenticated;
