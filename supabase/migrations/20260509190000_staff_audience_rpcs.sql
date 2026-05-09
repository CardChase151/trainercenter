-- Audience resolution RPCs powering /staff/comms.
-- The page lets admins compose a broadcast against a flexible audience
-- definition (jsonb). Both RPCs share the same WHERE-clause logic so the
-- count preview and the eventual send target the exact same rows.
--
-- Audience config shape:
--   {
--     "base": "marketing_contacts" | "vendors",
--     "include_unsubscribed": false,            // marketing_contacts only
--     "must_be_member": false,                  // marketing_contacts only
--     "must_be_vendor": false,                  // marketing_contacts only
--     "subs_any": ["trade_night", "tournament"],// marketing_contacts only
--     "vendor_status": "approved",              // vendors only
--     "vendor_event_id": "uuid",                // vendors only (optional)
--     "vendor_event_status": "approved"         // vendors only (optional)
--   }
--
-- Both functions are admin-gated SECURITY DEFINER. The 'authenticated'
-- grant is required so the supabase-js anon client (logged-in admin) can
-- call them; the body re-asserts profiles.is_admin = true before doing
-- anything.

-- ─── Marketing-contacts WHERE-clause helper ─────────────
-- Inlined into both count + emails RPCs because plpgsql doesn't let us
-- compose dynamic WHERE clauses across functions cleanly.

CREATE OR REPLACE FUNCTION public.staff_audience_count(p_audience jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_base text;
  v_count bigint := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_base := COALESCE(p_audience->>'base', 'marketing_contacts');

  IF v_base = 'marketing_contacts' THEN
    SELECT count(*) INTO v_count
    FROM public.marketing_contacts mc
    LEFT JOIN auth.users u ON u.email IS NOT NULL AND lower(u.email) = mc.email
    WHERE mc.email IS NOT NULL
      AND (
        COALESCE((p_audience->>'include_unsubscribed')::boolean, false) = true
        OR mc.is_subscribed = true
      )
      AND (
        COALESCE((p_audience->>'must_be_member')::boolean, false) = false
        OR EXISTS (SELECT 1 FROM public.members m WHERE m.user_id = u.id)
      )
      AND (
        COALESCE((p_audience->>'must_be_vendor')::boolean, false) = false
        OR EXISTS (SELECT 1 FROM public.vendors v WHERE v.user_id = u.id)
      )
      AND (
        p_audience->'subs_any' IS NULL
        OR jsonb_typeof(p_audience->'subs_any') <> 'array'
        OR jsonb_array_length(p_audience->'subs_any') = 0
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(p_audience->'subs_any') AS k
          WHERE (mc.subscriptions->>k)::boolean IS TRUE
        )
      );
  ELSIF v_base = 'vendors' THEN
    SELECT count(*) INTO v_count
    FROM public.vendors v
    WHERE v.email IS NOT NULL
      AND (
        COALESCE(p_audience->>'vendor_status', 'approved') = 'all'
        OR v.status = COALESCE(p_audience->>'vendor_status', 'approved')
      )
      AND (
        p_audience->>'vendor_event_id' IS NULL
        OR EXISTS (
          SELECT 1 FROM public.vendor_applications va
          WHERE va.event_id = (p_audience->>'vendor_event_id')::uuid
            AND va.vendor_id = v.id
            AND (
              COALESCE(p_audience->>'vendor_event_status', 'any') = 'any'
              OR va.status = COALESCE(p_audience->>'vendor_event_status', 'any')
            )
        )
      );
  ELSE
    RAISE EXCEPTION 'Unsupported audience base: %', v_base;
  END IF;

  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.staff_audience_count(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_audience_emails(p_audience jsonb, p_limit int DEFAULT 1000)
RETURNS TABLE (email text, first_name text, last_name text, role_label text)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_base text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_base := COALESCE(p_audience->>'base', 'marketing_contacts');

  IF v_base = 'marketing_contacts' THEN
    RETURN QUERY
    SELECT mc.email, mc.first_name, mc.last_name, 'contact'::text
    FROM public.marketing_contacts mc
    LEFT JOIN auth.users u ON u.email IS NOT NULL AND lower(u.email) = mc.email
    WHERE mc.email IS NOT NULL
      AND (
        COALESCE((p_audience->>'include_unsubscribed')::boolean, false) = true
        OR mc.is_subscribed = true
      )
      AND (
        COALESCE((p_audience->>'must_be_member')::boolean, false) = false
        OR EXISTS (SELECT 1 FROM public.members m WHERE m.user_id = u.id)
      )
      AND (
        COALESCE((p_audience->>'must_be_vendor')::boolean, false) = false
        OR EXISTS (SELECT 1 FROM public.vendors v WHERE v.user_id = u.id)
      )
      AND (
        p_audience->'subs_any' IS NULL
        OR jsonb_typeof(p_audience->'subs_any') <> 'array'
        OR jsonb_array_length(p_audience->'subs_any') = 0
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(p_audience->'subs_any') AS k
          WHERE (mc.subscriptions->>k)::boolean IS TRUE
        )
      )
    ORDER BY mc.created_at DESC
    LIMIT p_limit;
  ELSIF v_base = 'vendors' THEN
    RETURN QUERY
    SELECT v.email, v.first_name, v.last_name, 'vendor'::text
    FROM public.vendors v
    WHERE v.email IS NOT NULL
      AND (
        COALESCE(p_audience->>'vendor_status', 'approved') = 'all'
        OR v.status = COALESCE(p_audience->>'vendor_status', 'approved')
      )
      AND (
        p_audience->>'vendor_event_id' IS NULL
        OR EXISTS (
          SELECT 1 FROM public.vendor_applications va
          WHERE va.event_id = (p_audience->>'vendor_event_id')::uuid
            AND va.vendor_id = v.id
            AND (
              COALESCE(p_audience->>'vendor_event_status', 'any') = 'any'
              OR va.status = COALESCE(p_audience->>'vendor_event_status', 'any')
            )
        )
      )
    ORDER BY v.created_at DESC
    LIMIT p_limit;
  ELSE
    RAISE EXCEPTION 'Unsupported audience base: %', v_base;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.staff_audience_emails(jsonb, int) TO authenticated;
