-- Add boolean source flags so a contact can belong to BOTH the Square list
-- AND the site signup list at once. Future blasts can target the
-- intersection or either set independently:
--   from_square AND NOT from_site  -- never signed up on the site
--   from_site   AND NOT from_square -- never bought at the shop
--   from_square AND from_site       -- both
--
-- The existing 'source' text column stays as the "primary origin" for
-- audit. The new booleans accumulate as data flows in.

ALTER TABLE public.marketing_contacts
  ADD COLUMN IF NOT EXISTS from_square boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS from_site   boolean NOT NULL DEFAULT false;

UPDATE public.marketing_contacts
   SET from_square = (source = 'square'      OR square_customer_id IS NOT NULL),
       from_site   = (source IN ('app_member','app_vendor') OR member_id IS NOT NULL OR vendor_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS marketing_contacts_from_square_idx
  ON public.marketing_contacts (from_square) WHERE from_square = true;
CREATE INDEX IF NOT EXISTS marketing_contacts_from_site_idx
  ON public.marketing_contacts (from_site)   WHERE from_site   = true;

-- App-signup upsert: from_site=true on insert; preserves from_square if
-- already set (Square sync had them first). Note: ON CONFLICT must repeat
-- the partial-index predicate (WHERE email IS NOT NULL) for Postgres to
-- match it.
CREATE OR REPLACE FUNCTION public.upsert_marketing_contact_from_app(
  p_email text, p_first_name text, p_last_name text, p_phone text,
  p_source text, p_member_id uuid, p_vendor_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_email text;
BEGIN
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN RETURN; END IF;
  v_email := lower(trim(p_email));
  IF p_source NOT IN ('app_member', 'app_vendor') THEN
    RAISE EXCEPTION 'Invalid source % for app upsert', p_source;
  END IF;
  INSERT INTO public.marketing_contacts (
    email, first_name, last_name, phone, source, member_id, vendor_id,
    from_square, from_site
  )
  VALUES (
    v_email, p_first_name, p_last_name, p_phone, p_source, p_member_id, p_vendor_id,
    false, true
  )
  ON CONFLICT (email) WHERE email IS NOT NULL DO UPDATE SET
    first_name  = COALESCE(public.marketing_contacts.first_name, EXCLUDED.first_name),
    last_name   = COALESCE(public.marketing_contacts.last_name,  EXCLUDED.last_name),
    phone       = COALESCE(public.marketing_contacts.phone,      EXCLUDED.phone),
    member_id   = COALESCE(public.marketing_contacts.member_id,  EXCLUDED.member_id),
    vendor_id   = COALESCE(public.marketing_contacts.vendor_id,  EXCLUDED.vendor_id),
    source      = CASE WHEN public.marketing_contacts.source = 'square'
                       THEN public.marketing_contacts.source ELSE EXCLUDED.source END,
    from_site   = true,
    updated_at  = now();
END;
$$;

-- Square bulk upsert: from_square=true on insert; preserves from_site if
-- already set (someone signed up on the site first, then bought at the
-- shop and got pulled in by Square sync).
DROP FUNCTION IF EXISTS public.bulk_upsert_square_customers(jsonb);
CREATE OR REPLACE FUNCTION public.bulk_upsert_square_customers(p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_row jsonb;
BEGIN
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_data)
  LOOP
    BEGIN
      INSERT INTO public.marketing_contacts (
        email, first_name, last_name, phone, source, square_customer_id,
        is_subscribed, unsubscribed_at, unsubscribe_reason, subscriptions, last_synced_at,
        from_square, from_site
      )
      VALUES (
        NULLIF(LOWER(TRIM(v_row->>'email')), ''),
        NULLIF(TRIM(v_row->>'first_name'), ''),
        NULLIF(TRIM(v_row->>'last_name'),  ''),
        NULLIF(TRIM(v_row->>'phone'),      ''),
        'square',
        v_row->>'square_customer_id',
        COALESCE((v_row->>'is_subscribed')::boolean, true),
        CASE WHEN COALESCE((v_row->>'is_subscribed')::boolean, true) THEN NULL ELSE now() END,
        CASE WHEN COALESCE((v_row->>'is_subscribed')::boolean, true) THEN NULL ELSE 'square_preference' END,
        CASE WHEN COALESCE((v_row->>'is_subscribed')::boolean, true) THEN
               '{"vendor_day": true, "store_news": true, "events": true, "blog": true}'::jsonb
             ELSE
               '{"vendor_day": false, "store_news": false, "events": false, "blog": false}'::jsonb END,
        now(),
        true, false
      )
      ON CONFLICT (square_customer_id) WHERE square_customer_id IS NOT NULL DO UPDATE SET
        first_name  = COALESCE(public.marketing_contacts.first_name, EXCLUDED.first_name),
        last_name   = COALESCE(public.marketing_contacts.last_name,  EXCLUDED.last_name),
        phone       = COALESCE(public.marketing_contacts.phone,      EXCLUDED.phone),
        email       = COALESCE(public.marketing_contacts.email,      EXCLUDED.email),
        from_square = true,
        last_synced_at = now(), updated_at = now();
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN unique_violation THEN
      BEGIN
        INSERT INTO public.marketing_contacts (
          email, first_name, last_name, phone, source, square_customer_id,
          is_subscribed, subscriptions, last_synced_at, from_square, from_site
        )
        VALUES (
          NULL,
          NULLIF(TRIM(v_row->>'first_name'), ''),
          NULLIF(TRIM(v_row->>'last_name'),  ''),
          NULLIF(TRIM(v_row->>'phone'),      ''),
          'square',
          v_row->>'square_customer_id',
          COALESCE((v_row->>'is_subscribed')::boolean, true),
          '{"vendor_day": true, "store_news": true, "events": true, "blog": true}'::jsonb,
          now(),
          true, false
        )
        ON CONFLICT (square_customer_id) WHERE square_customer_id IS NOT NULL DO NOTHING;
        v_inserted := v_inserted + 1;
      EXCEPTION WHEN OTHERS THEN
        v_skipped := v_skipped + 1;
      END;
    END;
  END LOOP;
  RETURN jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
END;
$$;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_square_customers(jsonb) TO anon, authenticated;

-- Backfill existing vendors and members into the contact list so the
-- people who signed up before the hooks existed don't get left out.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT v.id, v.email, v.first_name, v.last_name, v.phone FROM public.vendors v
           WHERE v.email IS NOT NULL AND length(trim(v.email)) > 0
  LOOP
    PERFORM public.upsert_marketing_contact_from_app(
      r.email, r.first_name, r.last_name, r.phone, 'app_vendor', NULL, r.id
    );
  END LOOP;
  FOR r IN SELECT m.id, m.email, m.first_name, m.last_name FROM public.members m
           WHERE m.email IS NOT NULL AND length(trim(m.email)) > 0
  LOOP
    PERFORM public.upsert_marketing_contact_from_app(
      r.email, r.first_name, r.last_name, NULL, 'app_member', r.id, NULL
    );
  END LOOP;
END$$;

-- Role-aware view. Joins to members/vendors/profiles so segmentation
-- queries can ask "who's a vendor / member / admin?" without remembering
-- the joins. Inherits RLS from marketing_contacts (admins only).
CREATE OR REPLACE VIEW public.marketing_contacts_with_roles AS
SELECT
  mc.*,
  (mc.vendor_id IS NOT NULL) AS is_vendor,
  (mc.member_id IS NOT NULL) AS is_member,
  COALESCE(p.is_admin, false) AS is_admin,
  (mc.email IS NOT NULL)      AS has_email,
  (mc.phone IS NOT NULL)      AS has_phone
FROM public.marketing_contacts mc
LEFT JOIN public.members  m  ON m.id  = mc.member_id
LEFT JOIN public.vendors  v  ON v.id  = mc.vendor_id
LEFT JOIN public.profiles p  ON p.id  = COALESCE(m.user_id, v.user_id);
