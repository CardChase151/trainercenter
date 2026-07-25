-- Vendor rules agreement moves up to the partner level.
--
-- The six event rules (Pokemon only, no sealed from the last 12 months, the
-- full 12-to-10 day, rotate your spot, one team) used to be ticked on every
-- single date application. They're partnership terms, not per-date terms, so
-- agreement now lives on the vendor and is asked for exactly once:
--
--   * New partners agree during signup, before Chef ever sees the application.
--   * Partners approved before this shipped get the checklist on their next
--     date application, then never again.
--
-- vendor_applications.terms_agreed_at stays exactly as it is — it's the
-- per-application audit trail ("this is the moment they ticked the boxes").
-- This column is the gate that decides whether to ask at all.
--
-- terms_version lets the rules change later: bump the constant in the app and
-- everyone whose stored version is behind gets asked once more. Without it,
-- rewriting the sealed-product rule next year would silently apply to people
-- who only ever agreed to the old wording.

alter table public.vendors
  add column if not exists terms_agreed_at timestamptz,
  add column if not exists terms_version integer;

comment on column public.vendors.terms_agreed_at is
  'When this vendor ticked every partnership rule (at signup, or on their first date application after the rules moved up). NULL = never agreed, so ask them next time they apply.';

comment on column public.vendors.terms_version is
  'Which revision of the rules they agreed to. Behind the app constant = ask again.';

-- Backfill: anyone who already ticked the boxes on a date application has
-- agreed, and should not be asked a second time. Their earliest agreement is
-- the honest timestamp — that's the moment they actually read the rules.
update public.vendors v
set terms_agreed_at = sub.first_agreed,
    terms_version = 1
from (
  select vendor_id, min(terms_agreed_at) as first_agreed
  from public.vendor_applications
  where terms_agreed_at is not null
  group by vendor_id
) sub
where v.id = sub.vendor_id
  and v.terms_agreed_at is null;
