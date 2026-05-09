-- The daily square-customer-sync edge function fans new POS contacts into
-- marketing_contacts via this RPC. The previous defaults were a 4-key map
-- (vendor_day / store_news / events / blog) from the original launch. With
-- the calendar reminder system and the new CATEGORIES dict in place, fresh
-- Square contacts now ship with every category on by default — same shape
-- the bulk-on update we just ran on existing rows. Anyone who walks into
-- the shop and gets pulled in via Square shows up in /staff/comms filters
-- immediately.
--
-- Body is identical to the previous version; only the subscriptions JSONB
-- literals changed. Unsubscribed Square customers still come in with every
-- category false so we never email someone who opted out at the register.

DROP FUNCTION IF EXISTS public.bulk_upsert_square_customers(jsonb);
CREATE OR REPLACE FUNCTION public.bulk_upsert_square_customers(p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_row jsonb;
  v_default_subs_on  jsonb := '{
    "trade_night":    true,
    "tournament":     true,
    "game_day":       true,
    "crafts":         true,
    "consultation":   true,
    "tc_trade_night": true,
    "on_the_road":    true,
    "other":          true,
    "store_news":     true,
    "blog":           true
  }'::jsonb;
  v_default_subs_off jsonb := '{
    "trade_night":    false,
    "tournament":     false,
    "game_day":       false,
    "crafts":         false,
    "consultation":   false,
    "tc_trade_night": false,
    "on_the_road":    false,
    "other":          false,
    "store_news":     false,
    "blog":           false
  }'::jsonb;
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
        CASE WHEN COALESCE((v_row->>'is_subscribed')::boolean, true) THEN v_default_subs_on ELSE v_default_subs_off END,
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
          v_default_subs_on,
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
