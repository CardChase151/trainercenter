-- Close a privilege-escalation hole in profiles.
--
-- Found 2026-07-24 while verifying the Trainer Center / Shiny Vault admin split.
-- The "Users can update own profile" policy is `using (auth.uid() = id)` with a
-- matching with_check and NO column restriction. Postgres RLS cannot limit which
-- columns an UPDATE touches, so any authenticated user could PATCH their own
-- profiles row and set is_admin = true. Verified live against a real account:
-- a non-admin user granted themselves Trainer Center admin in one REST call.
--
-- This predates the admin split — it has been reachable by every account on the
-- project — but it also makes the split meaningless, since a Shiny Vault admin
-- could simply hand themselves Trainer Center admin.
--
-- Fix: a BEFORE UPDATE trigger that rejects any change to a privilege column
-- unless the caller is server-side (service_role / SECURITY DEFINER with no JWT)
-- or is already a Trainer Center admin. Ordinary self-service edits (name, etc.)
-- are unaffected, so the existing policy stays as-is.
--
-- Flag management deliberately stays with Trainer Center admins (Chase, Brent,
-- Chef) — a Shiny Vault admin cannot grant Shiny Vault admin. Olin can run the
-- storefront; he cannot widen his own access or anyone else's.

create or replace function public.guard_profile_privilege_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_changed boolean;
begin
  v_changed :=
       (new.is_admin             is distinct from old.is_admin)
    or (new.is_shinyvault_admin  is distinct from old.is_shinyvault_admin)
    or (new.is_owner             is distinct from old.is_owner)
    or (new.role                 is distinct from old.role);

  if not v_changed then
    return new;
  end if;

  -- No JWT = service_role or a SECURITY DEFINER server path (signup trigger,
  -- staff_promote_to_admin invoked internally, migrations). Trusted.
  if v_uid is null then
    return new;
  end if;

  -- Trainer Center admins manage privilege for both apps.
  if coalesce((select p.is_admin from public.profiles p where p.id = v_uid), false) then
    return new;
  end if;

  raise exception
    'Not authorized to change privilege columns on profiles (attempted by %)', v_uid
    using errcode = '42501';
end;
$$;

drop trigger if exists guard_profile_privilege_columns on public.profiles;
create trigger guard_profile_privilege_columns
  before update on public.profiles
  for each row
  execute function public.guard_profile_privilege_columns();

-- Remove the vendor row auto-provisioned during the escalation test.
delete from public.vendors v
 where v.user_id = (select id from public.profiles where lower(email) = 'yatesolin@gmail.com')
   and v.name = v.email
   and not exists (select 1 from public.vendor_applications a where a.vendor_id = v.id)
   and not exists (select 1 from public.vendor_submissions  s where s.vendor_id = v.id)
   and not exists (select 1 from public.vendor_attendance   t where t.vendor_id = v.id);
