-- ShinyVault abandoned-cart recovery.
--
-- The cart itself stays client-side (localStorage, see CartContext). What this
-- adds is a server-side "lead": the moment the store knows who a shopper is
-- (email typed at checkout, or signed in with items in the cart) the cart is
-- mirrored here so shinyvault-cart-reminder can nudge them if they leave.
--
-- Anonymous visitors with no email never produce a lead. They get an on-site
-- "still waiting" banner instead, which needs nothing from the server.
--
-- Sequence: up to 3 emails per lead, at ~1h / ~24h / ~72h after the last cart
-- activity. A lead closes on purchase, emptied cart, everything sold out,
-- unsubscribe, or after the third email. A shopper whose lead finished gets no
-- new lead for 14 days, so repeat browsing can't turn into a weekly drip.

create table if not exists public.sv_cart_leads (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  user_id uuid references auth.users(id) on delete set null,
  items jsonb not null default '[]'::jsonb,       -- [{product_id, quantity}]
  source text not null check (source in ('checkout', 'account', 'order')),
  token uuid not null unique default gen_random_uuid(), -- restore + unsubscribe links
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  steps_sent int not null default 0,
  last_sent_at timestamptz,
  closed_at timestamptz,
  closed_reason text
);

-- One open lead per shopper.
create unique index if not exists sv_cart_leads_one_open
  on public.sv_cart_leads (lower(email)) where closed_at is null;
create index if not exists sv_cart_leads_due
  on public.sv_cart_leads (last_activity_at) where closed_at is null;

create table if not exists public.sv_email_optouts (
  email text primary key,                          -- stored lowercased
  created_at timestamptz not null default now()
);

create table if not exists public.sv_cart_email_log (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.sv_cart_leads(id) on delete cascade,
  step int not null,
  email text not null,
  resend_id text,
  sent_at timestamptz not null default now()
);

-- No direct table access for shoppers. Everything goes through the security
-- definer functions below; staff can read for the admin view.
alter table public.sv_cart_leads enable row level security;
alter table public.sv_email_optouts enable row level security;
alter table public.sv_cart_email_log enable row level security;

create policy sv_cart_leads_admin_read on public.sv_cart_leads
  for select using (public.is_shinyvault_admin(auth.uid()));
create policy sv_cart_email_log_admin_read on public.sv_cart_email_log
  for select using (public.is_shinyvault_admin(auth.uid()));
create policy sv_email_optouts_admin_read on public.sv_email_optouts
  for select using (public.is_shinyvault_admin(auth.uid()));

-- Mirror a cart. Called from the checkout page (email typed) and from the
-- cart for signed-in shoppers. p_email is ignored for a signed-in caller: the
-- account email wins, so a signed-in session can't enroll someone else.
create or replace function public.sv_capture_cart(p_email text, p_items jsonb, p_source text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_items jsonb;
  v_open uuid;
begin
  if p_source not in ('checkout', 'account') then return; end if;

  if v_uid is not null then
    select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  else
    v_email := lower(trim(coalesce(p_email, '')));
  end if;
  if v_email is null or length(v_email) > 254
     or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return;
  end if;

  if exists (select 1 from sv_email_optouts o where o.email = v_email) then return; end if;

  -- Keep only real, sellable products and sane quantities.
  select coalesce(jsonb_agg(jsonb_build_object('product_id', p.id, 'quantity', least(greatest(x.quantity, 1), 20))), '[]'::jsonb)
    into v_items
  from (
    select distinct on ((e->>'product_id')) (e->>'product_id')::uuid as product_id, (e->>'quantity')::int as quantity
    from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) e
    where (e->>'product_id') ~ '^[0-9a-f-]{36}$' and (e->>'quantity') ~ '^[0-9]+$'
    limit 30
  ) x
  join products p on p.id = x.product_id and p.status = 'active';

  select id into v_open from sv_cart_leads
  where lower(email) = v_email and closed_at is null;

  if jsonb_array_length(v_items) = 0 then
    if v_open is not null then
      update sv_cart_leads set closed_at = now(), closed_reason = 'emptied' where id = v_open;
    end if;
    return;
  end if;

  if v_open is not null then
    update sv_cart_leads
       set items = v_items, last_activity_at = now(), user_id = coalesce(v_uid, user_id)
     where id = v_open;
    return;
  end if;

  -- Cool-off after a finished sequence.
  if exists (
    select 1 from sv_cart_leads
    where lower(email) = v_email and closed_reason = 'finished'
      and closed_at > now() - interval '14 days'
  ) then
    return;
  end if;

  insert into sv_cart_leads (email, user_id, items, source)
  values (v_email, v_uid, v_items, p_source)
  on conflict do nothing;
end;
$$;

-- Rebuild a cart from an email link. Returns only what can still be bought.
create or replace function public.sv_restore_cart(p_token uuid)
returns table (product_id uuid, quantity int, name text, slug text, price_cents int, storage_path text)
language sql
security definer
set search_path = public
as $$
  select p.id,
         least((e->>'quantity')::int, p.quantity_available),
         p.name, p.slug, p.price_cents,
         (select m.storage_path from product_media m
           where m.product_id = p.id and m.storage_path is not null
           order by m.sort_order limit 1)
  from sv_cart_leads l
  cross join lateral jsonb_array_elements(l.items) e
  join products p on p.id = (e->>'product_id')::uuid
  where l.token = p_token and p.status = 'active' and p.quantity_available > 0;
$$;

create or replace function public.sv_cart_unsubscribe(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_email text;
begin
  select lower(email) into v_email from sv_cart_leads where token = p_token;
  if v_email is null then return false; end if;
  insert into sv_email_optouts (email) values (v_email) on conflict do nothing;
  update sv_cart_leads set closed_at = now(), closed_reason = 'unsubscribed'
   where lower(email) = v_email and closed_at is null;
  return true;
end;
$$;

revoke all on function public.sv_capture_cart(text, jsonb, text) from public;
revoke all on function public.sv_restore_cart(uuid) from public;
revoke all on function public.sv_cart_unsubscribe(uuid) from public;
grant execute on function public.sv_capture_cart(text, jsonb, text) to anon, authenticated;
grant execute on function public.sv_restore_cart(uuid) to anon, authenticated;
grant execute on function public.sv_cart_unsubscribe(uuid) to anon, authenticated;

-- Every 15 minutes. The function is idempotent: each send claims its step
-- with a conditional update first, so an overlapping run can't double-send.
select cron.schedule(
  'shinyvault-cart-reminder',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://tfneuzbhiqsdvnhhdfsw.supabase.co/functions/v1/shinyvault-cart-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmbmV1emJoaXFzZHZuaGhkZnN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2NzcwNTEsImV4cCI6MjA5MDI1MzA1MX0.L90y9Cy1QeSQLkql3O8gaHSbGNIQ-NXjIM6hdzFEVf0'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) as request_id;
  $$
);
