-- Split admin privilege per app (Trainer Center vs Shiny Vault).
--
-- Context: both sites are the same parent company on the same Supabase project
-- and share one identity — if you have an account on Trainer Center you have the
-- same account on Shiny Vault. That does NOT change here. The ONLY thing being
-- separated is the admin privilege level, so someone can run one storefront's
-- back office without inheriting the other's.
--
-- Approach: `profiles.is_admin` keeps its existing meaning (Trainer Center
-- admin) so none of Trainer Center's ~37 RLS policies have to be touched — that
-- app is live with real money and real vendors, and rewriting its policy surface
-- is risk with no upside. Shiny Vault gets its own flag and its own helper, and
-- only the 12 commerce-table policies move over to it.
--
-- Roster after this migration:
--   Chase  — admin on both
--   Brent  — admin on both
--   Olin   — Shiny Vault only (no Trainer Center admin)
--   Seth   — admin on neither (revoked, per Chase 2026-07-24)
--   Chef   — Trainer Center only (unchanged)

begin;

-- 1. The new flag ---------------------------------------------------------

alter table public.profiles
  add column if not exists is_shinyvault_admin boolean not null default false;

comment on column public.profiles.is_admin is
  'Trainer Center admin. Gates Trainer Center staff pages/policies ONLY — not Shiny Vault.';
comment on column public.profiles.is_shinyvault_admin is
  'Shiny Vault admin. Gates the Shiny Vault back office (products, orders, media, requests) ONLY — not Trainer Center.';

-- 2. Helper, mirroring the existing is_admin() ----------------------------
-- SECURITY DEFINER so the policy check can read profiles without tripping
-- profiles'' own RLS (same pattern/rationale as public.is_admin).

create or replace function public.is_shinyvault_admin(check_uid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select is_shinyvault_admin from public.profiles where id = check_uid),
    false
  );
$$;

revoke all on function public.is_shinyvault_admin(uuid) from public;
grant execute on function public.is_shinyvault_admin(uuid) to authenticated, anon, service_role;

-- 3. Backfill BEFORE swapping the policies --------------------------------
-- Ordering matters: grant the new flag first so no one loses the back office
-- for the instant between the policy swap and the backfill.

update public.profiles
   set is_shinyvault_admin = true,
       updated_at = now()
 where lower(email) in (
   'thek2way17@gmail.com',   -- Chase
   'brentdc84@gmail.com',    -- Brent
   'yatesolin@gmail.com'     -- Olin
 );

-- 4. Move the 12 Shiny Vault commerce policies onto the new flag ----------
-- Every one of these was is_admin(auth.uid()); the customer-facing and public
-- policies on these tables are deliberately left alone.

drop policy if exists "Admins can manage categories"      on public.categories;
create policy "Admins can manage categories" on public.categories
  for all to authenticated
  using (public.is_shinyvault_admin(auth.uid()))
  with check (public.is_shinyvault_admin(auth.uid()));

drop policy if exists "Admins can manage products"        on public.products;
create policy "Admins can manage products" on public.products
  for all to authenticated
  using (public.is_shinyvault_admin(auth.uid()))
  with check (public.is_shinyvault_admin(auth.uid()));

drop policy if exists "Admins can view all products"      on public.products;
create policy "Admins can view all products" on public.products
  for select to authenticated
  using (public.is_shinyvault_admin(auth.uid()));

drop policy if exists "Admins can manage product media"   on public.product_media;
create policy "Admins can manage product media" on public.product_media
  for all to authenticated
  using (public.is_shinyvault_admin(auth.uid()))
  with check (public.is_shinyvault_admin(auth.uid()));

drop policy if exists "Admins can manage shipping boxes"  on public.shipping_boxes;
create policy "Admins can manage shipping boxes" on public.shipping_boxes
  for all to authenticated
  using (public.is_shinyvault_admin(auth.uid()))
  with check (public.is_shinyvault_admin(auth.uid()));

drop policy if exists "Admins can view all orders"        on public.orders;
create policy "Admins can view all orders" on public.orders
  for select to authenticated
  using (public.is_shinyvault_admin(auth.uid()));

drop policy if exists "Admins can update orders"          on public.orders;
create policy "Admins can update orders" on public.orders
  for update to authenticated
  using (public.is_shinyvault_admin(auth.uid()))
  with check (public.is_shinyvault_admin(auth.uid()));

drop policy if exists "Admins can view all order items"   on public.order_items;
create policy "Admins can view all order items" on public.order_items
  for select to authenticated
  using (public.is_shinyvault_admin(auth.uid()));

drop policy if exists "Admins can view wishlists"         on public.wishlist_items;
create policy "Admins can view wishlists" on public.wishlist_items
  for select to authenticated
  using (public.is_shinyvault_admin(auth.uid()));

drop policy if exists "Admins can view all requests"      on public.want_list_items;
create policy "Admins can view all requests" on public.want_list_items
  for select to authenticated
  using (public.is_shinyvault_admin(auth.uid()));

drop policy if exists "Admins can update requests"        on public.want_list_items;
create policy "Admins can update requests" on public.want_list_items
  for update to authenticated
  using (public.is_shinyvault_admin(auth.uid()))
  with check (public.is_shinyvault_admin(auth.uid()));

-- 5. Profiles: let a Shiny Vault admin read customers ---------------------
-- The orders screen and the want-list match panel show who placed an order /
-- made a request. Trainer Center''s blanket "Admins can view all profiles"
-- policy is left untouched; this is an additive SELECT for the other app.
-- Note it is READ ONLY on purpose — a Shiny Vault admin must not be able to
-- edit profiles, because that is the table holding both admin flags. Letting
-- them write here would let them grant themselves Trainer Center admin and the
-- whole separation would be theatre.

drop policy if exists "ShinyVault admins can view all profiles" on public.profiles;
create policy "ShinyVault admins can view all profiles" on public.profiles
  for select to authenticated
  using (public.is_shinyvault_admin(auth.uid()));

-- 6. Apply the roster changes --------------------------------------------
-- Olin: Shiny Vault only. Dropping is_admin also stops him showing up as
-- Trainer Center staff. (His auto-created vendor row is cleaned up below.)

update public.profiles
   set is_admin = false,
       role = case when role = 'admin' then 'user' else role end,
       updated_at = now()
 where lower(email) = 'yatesolin@gmail.com';

-- Seth: admin revoked on both apps, per Chase 2026-07-24.
update public.profiles
   set is_admin = false,
       is_shinyvault_admin = false,
       role = case when role = 'admin' then 'user' else role end,
       updated_at = now()
 where lower(email) = 'seth@trainercenter.com';

-- 7. Clean up the side effect of the earlier is_admin flip -----------------
-- public.ensure_admin_has_vendor_row() fires whenever profiles.is_admin flips
-- true and inserts an APPROVED row into Trainer Center''s vendors table. Olin
-- got one at 2026-07-24 20:26 UTC purely as a side effect of being granted
-- admin for Shiny Vault. Remove it — he is not a Trainer Center vendor.
-- Guarded so it only deletes an untouched auto-provisioned row.

delete from public.vendors v
 where v.user_id = (select id from public.profiles where lower(email) = 'yatesolin@gmail.com')
   and v.name = v.email
   and not exists (select 1 from public.vendor_applications  a where a.vendor_id = v.id)
   and not exists (select 1 from public.vendor_submissions   s where s.vendor_id = v.id)
   and not exists (select 1 from public.vendor_attendance    t where t.vendor_id = v.id);

commit;
