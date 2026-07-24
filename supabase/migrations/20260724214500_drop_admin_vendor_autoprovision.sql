-- Stop auto-registering admins as Trainer Center vendors.
--
-- ensure_admin_has_vendor_row() fired on every profiles UPDATE where is_admin
-- became true and inserted an APPROVED row into vendors. Being an admin and
-- being a vendor are unrelated facts, so this quietly turned staff into
-- approved vendors as a side effect of a permission change. It bit twice on
-- 2026-07-24 while setting up Olin's Shiny Vault access.
--
-- Nothing depends on it:
--   - VendorDashboardPage explicitly handles "Staff (admin), no vendor row"
--     as its own state (App.js, state 2 of 5) and renders the staff hub.
--   - Chef has been is_admin with no vendor row the entire time, no issue.
--   - The two rows it auto-created (Chase, Brent) have zero applications,
--     submissions, and attendance between them.
--
-- Vendors should be created the normal way: an application, or staff adding
-- them in /staff/vendors. Not as a byproduct of a permission flip.

-- NB: the trigger is named profile_admin_ensure_vendor; the function it calls
-- is ensure_admin_has_vendor_row. Dropping by the function name silently
-- no-ops, which is exactly the sort of thing that leaves this "fixed" but live.
drop trigger if exists profile_admin_ensure_vendor on public.profiles;
drop function if exists public.ensure_admin_has_vendor_row();
