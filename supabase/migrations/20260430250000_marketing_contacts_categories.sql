-- Follow-up to marketing_contacts: support no-email rows (for future SMS
-- and to record customers we don't have any contact info on yet) and add
-- per-category subscription preferences so the unsubscribe page can be
-- granular (uncheck just vendor_day, etc.).

-- 1. Email becomes nullable so phone-only / contact-less Square customers
--    can be archived. Email uniqueness becomes partial.
ALTER TABLE public.marketing_contacts ALTER COLUMN email DROP NOT NULL;
DROP INDEX IF EXISTS public.marketing_contacts_email_uq;
CREATE UNIQUE INDEX marketing_contacts_email_uq
  ON public.marketing_contacts (email)
  WHERE email IS NOT NULL;

-- 2. Per-category subscription state. Default: subscribed to everything
--    until the recipient explicitly opts out of specific categories.
ALTER TABLE public.marketing_contacts
  ADD COLUMN IF NOT EXISTS subscriptions jsonb NOT NULL DEFAULT
  '{"vendor_day": true, "store_news": true, "events": true, "blog": true}'::jsonb;

-- 3. Lookup RPC now also returns the current subscriptions object so the
--    page can hydrate its checkbox state.
DROP FUNCTION IF EXISTS public.lookup_marketing_contact_by_token(uuid);
CREATE OR REPLACE FUNCTION public.lookup_marketing_contact_by_token(p_token uuid)
RETURNS TABLE (email text, first_name text, is_subscribed boolean, subscriptions jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT mc.email, mc.first_name, mc.is_subscribed, mc.subscriptions
    FROM public.marketing_contacts mc
   WHERE mc.unsubscribe_token = p_token;
END;
$$;
GRANT EXECUTE ON FUNCTION public.lookup_marketing_contact_by_token(uuid) TO anon, authenticated;

-- 4. Granular update RPC: replace the subscriptions object. If every
--    value is false, treat as global unsubscribe.
CREATE OR REPLACE FUNCTION public.update_marketing_subscriptions(
  p_token uuid, p_subscriptions jsonb
)
RETURNS TABLE (email text, first_name text, is_subscribed boolean, subscriptions jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_any_true boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM jsonb_each(p_subscriptions) AS kv WHERE (kv.value)::text = 'true'
  ) INTO v_any_true;

  RETURN QUERY
  UPDATE public.marketing_contacts mc
     SET subscriptions = p_subscriptions,
         is_subscribed = v_any_true,
         unsubscribed_at = CASE WHEN v_any_true THEN NULL ELSE now() END,
         unsubscribe_reason = CASE WHEN v_any_true THEN NULL ELSE 'self_unsubscribe_all' END,
         updated_at = now()
   WHERE mc.unsubscribe_token = p_token
   RETURNING mc.email, mc.first_name, mc.is_subscribed, mc.subscriptions;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_marketing_subscriptions(uuid, jsonb) TO anon, authenticated;

-- 5. Existing single-shot unsubscribe: also flips every category off.
CREATE OR REPLACE FUNCTION public.unsubscribe_marketing_contact(
  p_token uuid, p_reason text DEFAULT NULL
) RETURNS TABLE (email text, first_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE public.marketing_contacts mc
     SET is_subscribed = false,
         subscriptions = jsonb_build_object(
           'vendor_day', false, 'store_news', false, 'events', false, 'blog', false
         ),
         unsubscribed_at = now(),
         unsubscribe_reason = COALESCE(p_reason, 'self_unsubscribe_all'),
         updated_at = now()
   WHERE mc.unsubscribe_token = p_token
   RETURNING mc.email, mc.first_name;
END;
$$;

-- 6. Bulk upsert RPC for one-time Square seed (used once, kept for
--    Phase 2 incremental sync). Per-row exception handling so a single
--    duplicate-email row doesn't roll back the batch -- duplicate emails
--    fall back to inserting with email NULL so the customer record is
--    still preserved (linked by square_customer_id).
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
        is_subscribed, unsubscribed_at, unsubscribe_reason, subscriptions, last_synced_at
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
        now()
      )
      ON CONFLICT (square_customer_id) WHERE square_customer_id IS NOT NULL DO UPDATE SET
        first_name = COALESCE(public.marketing_contacts.first_name, EXCLUDED.first_name),
        last_name  = COALESCE(public.marketing_contacts.last_name,  EXCLUDED.last_name),
        phone      = COALESCE(public.marketing_contacts.phone,      EXCLUDED.phone),
        email      = COALESCE(public.marketing_contacts.email,      EXCLUDED.email),
        last_synced_at = now(), updated_at = now();
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN unique_violation THEN
      BEGIN
        INSERT INTO public.marketing_contacts (
          email, first_name, last_name, phone, source, square_customer_id,
          is_subscribed, subscriptions, last_synced_at
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
          now()
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
