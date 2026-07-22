-- Vendor event rules acknowledgement.
--
-- Applying now requires ticking every rule (Pokemon only, no recent sealed,
-- full vendor window, rotate your spot, support the other vendors). Stamping
-- the moment they agreed gives staff something to point at when someone turns
-- up with a table of One Piece or a wall of current ETBs.
--
-- Nullable on purpose: applications submitted before this shipped never had a
-- checklist to tick, and backfilling a consent they were never shown would be
-- a lie. NULL means "predates the rules screen", not "refused".

alter table public.vendor_applications
  add column if not exists terms_agreed_at timestamptz;

comment on column public.vendor_applications.terms_agreed_at is
  'When the vendor ticked every event rule on the apply screen. NULL = applied before the rules checklist existed.';
