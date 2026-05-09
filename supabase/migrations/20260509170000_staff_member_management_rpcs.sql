-- Staff member-management RPCs powering /staff/members.
--
-- Anti-spam policy: staff CAN remove subscriptions and unsubscribe contacts
-- entirely, and they CAN add a contact to the directory, but they cannot
-- enroll someone in new email categories. The RPCs below intentionally have
-- no "set subscription on" surface — only off / remove paths.
--
-- All functions assert is_admin on the caller via auth.uid() before doing
-- any work. Anonymous and non-admin authenticated users get a hard error.

-- ─── List members (paginated, searchable, role-filterable) ──
CREATE OR REPLACE FUNCTION public.staff_list_members(
  p_search text DEFAULT NULL,
  p_role_filter text DEFAULT 'all',
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  contact_id uuid,
  email text,
  first_name text,
  last_name text,
  phone text,
  source text,
  is_subscribed boolean,
  subscriptions jsonb,
  from_square boolean,
  from_site boolean,
  contact_created_at timestamptz,
  user_id uuid,
  is_staff_admin boolean,
  vendor_id uuid,
  vendor_name text,
  member_id uuid,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_search text := nullif(trim(coalesce(p_search, '')), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  WITH joined AS (
    SELECT
      mc.id AS contact_id,
      mc.email,
      mc.first_name,
      mc.last_name,
      mc.phone,
      mc.source,
      mc.is_subscribed,
      mc.subscriptions,
      mc.from_square,
      mc.from_site,
      mc.created_at AS contact_created_at,
      u.id AS user_id,
      p.is_admin AS is_staff_admin,
      v.id AS vendor_id,
      v.name AS vendor_name,
      m.id AS member_id
    FROM public.marketing_contacts mc
    LEFT JOIN auth.users u ON u.email IS NOT NULL AND lower(u.email) = mc.email
    LEFT JOIN public.profiles p ON p.id = u.id
    LEFT JOIN public.vendors v ON v.user_id = u.id
    LEFT JOIN public.members m ON m.user_id = u.id
  ),
  filtered AS (
    SELECT j.*
    FROM joined j
    WHERE (
      v_search IS NULL OR
      j.email ILIKE '%' || v_search || '%' OR
      coalesce(j.first_name, '') ILIKE '%' || v_search || '%' OR
      coalesce(j.last_name, '')  ILIKE '%' || v_search || '%'
    )
    AND (
      p_role_filter = 'all'
      OR (p_role_filter = 'staff'      AND j.is_staff_admin = true)
      OR (p_role_filter = 'vendor'     AND j.vendor_id IS NOT NULL)
      OR (p_role_filter = 'member'     AND j.member_id IS NOT NULL AND j.vendor_id IS NULL AND coalesce(j.is_staff_admin, false) = false)
      OR (p_role_filter = 'unattached' AND j.user_id IS NULL)
    )
  )
  SELECT
    f.contact_id, f.email, f.first_name, f.last_name, f.phone, f.source,
    f.is_subscribed, f.subscriptions, f.from_square, f.from_site,
    f.contact_created_at, f.user_id, f.is_staff_admin, f.vendor_id,
    f.vendor_name, f.member_id,
    (SELECT count(*) FROM filtered)::bigint AS total_count
  FROM filtered f
  ORDER BY f.contact_created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;
GRANT EXECUTE ON FUNCTION public.staff_list_members(text, text, int, int) TO authenticated;

-- ─── Remove a single category from a contact's subs ─────────
CREATE OR REPLACE FUNCTION public.staff_remove_subscription(
  p_email text,
  p_category text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RAISE EXCEPTION 'Missing email';
  END IF;
  IF p_category IS NULL OR length(trim(p_category)) = 0 THEN
    RAISE EXCEPTION 'Missing category';
  END IF;

  UPDATE public.marketing_contacts
     SET subscriptions = coalesce(subscriptions, '{}'::jsonb) || jsonb_build_object(p_category, false),
         updated_at = now()
   WHERE email = lower(p_email);
END;
$$;
GRANT EXECUTE ON FUNCTION public.staff_remove_subscription(text, text) TO authenticated;

-- ─── Unsubscribe entirely ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.staff_unsubscribe_all(p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RAISE EXCEPTION 'Missing email';
  END IF;

  UPDATE public.marketing_contacts
     SET is_subscribed = false,
         unsubscribed_at = now(),
         unsubscribe_reason = 'staff_action',
         updated_at = now()
   WHERE email = lower(p_email);
END;
$$;
GRANT EXECUTE ON FUNCTION public.staff_unsubscribe_all(text) TO authenticated;

-- ─── Add a manual marketing contact ────────────────────────
-- Anti-spam: contact starts with empty subscriptions object so no campaigns
-- fire. Staff cannot enroll someone in categories from here.
CREATE OR REPLACE FUNCTION public.staff_add_marketing_contact(
  p_email text,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_phone text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_existing_id uuid;
  v_new_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_email := lower(nullif(trim(coalesce(p_email, '')), ''));
  IF v_email IS NULL THEN RAISE EXCEPTION 'Missing email'; END IF;

  SELECT id INTO v_existing_id FROM public.marketing_contacts WHERE email = v_email LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  INSERT INTO public.marketing_contacts (
    email, first_name, last_name, phone, source,
    subscriptions, is_subscribed
  )
  VALUES (
    v_email,
    nullif(trim(coalesce(p_first_name, '')), ''),
    nullif(trim(coalesce(p_last_name, '')),  ''),
    nullif(trim(coalesce(p_phone, '')),      ''),
    'manual_add',
    '{}'::jsonb,
    true
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.staff_add_marketing_contact(text, text, text, text) TO authenticated;

-- ─── Promote an authenticated user to staff (admin) ────────
CREATE OR REPLACE FUNCTION public.staff_promote_to_admin(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'Missing user_id'; END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'User does not exist';
  END IF;

  INSERT INTO public.profiles (id, email, name, role, is_admin)
  VALUES (p_user_id, lower(v_email), v_email, 'staff', true)
  ON CONFLICT (id) DO UPDATE SET
    is_admin = true,
    role = CASE WHEN public.profiles.role = 'user' THEN 'staff' ELSE public.profiles.role END,
    updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.staff_promote_to_admin(uuid) TO authenticated;

-- ─── Promote an authenticated user to vendor ───────────────
-- Creates a basic vendors row if none exists, status='approved' since an
-- admin is doing the promotion. The vendor can fill in specialty/bio/etc
-- via their own dashboard afterward.
CREATE OR REPLACE FUNCTION public.staff_promote_to_vendor(
  p_user_id uuid,
  p_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_existing_vendor_id uuid;
  v_new_vendor_id uuid;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'Missing user_id'; END IF;

  SELECT id INTO v_existing_vendor_id FROM public.vendors WHERE user_id = p_user_id LIMIT 1;
  IF v_existing_vendor_id IS NOT NULL THEN
    UPDATE public.vendors
       SET status = 'approved',
           approved_by = COALESCE(approved_by, v_uid),
           approved_at = COALESCE(approved_at, now()),
           updated_at = now()
     WHERE id = v_existing_vendor_id;
    RETURN v_existing_vendor_id;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email IS NULL THEN RAISE EXCEPTION 'User does not exist'; END IF;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  IF v_name IS NULL THEN
    v_name := split_part(v_email, '@', 1);
  END IF;

  INSERT INTO public.vendors (user_id, name, email, status, approved_by, approved_at)
  VALUES (p_user_id, v_name, lower(v_email), 'approved', v_uid, now())
  RETURNING id INTO v_new_vendor_id;

  RETURN v_new_vendor_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.staff_promote_to_vendor(uuid, text) TO authenticated;
