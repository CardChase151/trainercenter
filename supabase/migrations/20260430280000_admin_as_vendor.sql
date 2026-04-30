-- Every admin is also a vendor. Vendors are NOT auto-promoted to admins.
-- Chase's preference: staff members default to having a vendor presence
-- so internal workflows that key on the vendors table don't skip them.
--
-- Backfill runs once. Trigger keeps the invariant true going forward.

-- 1. Backfill: every admin without a vendor row gets one with status=approved.
INSERT INTO public.vendors (user_id, name, email, status)
SELECT
  p.id,
  COALESCE(NULLIF(TRIM(p.name), ''), au.email, 'Staff'),
  au.email,
  'approved'
FROM public.profiles p
JOIN auth.users au ON au.id = p.id
WHERE p.is_admin = true
  AND NOT EXISTS (SELECT 1 FROM public.vendors v WHERE v.user_id = p.id);

-- 2. Trigger: when an admin is promoted (insert or update flips is_admin
--    to true), ensure they have a vendor row. SECURITY DEFINER so it can
--    write to vendors regardless of the caller's RLS context.
CREATE OR REPLACE FUNCTION public.ensure_admin_has_vendor_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email text;
  v_name  text;
BEGIN
  IF NEW.is_admin IS DISTINCT FROM true THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.vendors WHERE user_id = NEW.id) THEN
    RETURN NEW;
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = NEW.id;
  v_name := COALESCE(NULLIF(TRIM(NEW.name), ''), v_email, 'Staff');
  INSERT INTO public.vendors (user_id, name, email, status)
  VALUES (NEW.id, v_name, COALESCE(v_email, ''), 'approved');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profile_admin_ensure_vendor ON public.profiles;
CREATE TRIGGER profile_admin_ensure_vendor
  AFTER INSERT OR UPDATE OF is_admin ON public.profiles
  FOR EACH ROW
  WHEN (NEW.is_admin = true)
  EXECUTE FUNCTION public.ensure_admin_has_vendor_row();
