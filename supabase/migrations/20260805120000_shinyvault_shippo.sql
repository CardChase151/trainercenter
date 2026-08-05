-- ShinyVault: migrate shipping from EasyPost to Shippo.
--
-- Why the swap: EasyPost's signup never released an API key (account stuck in
-- what looked like an automated fraud hold, no support response). Shippo hands
-- out live keys directly from the dashboard with no approval queue, costs
-- $0.05/label on the $17/mo Pro plan, and — the part that actually matters
-- here — returns a customer-facing tracking URL and a printable label PDF in
-- the same response as the tracking number. EasyPost gave us the tracking code
-- only, which meant the owner had to log into a third-party dashboard every
-- morning to print labels.
--
-- Column shape change: EasyPost needed the *shipment* id stored at quote time,
-- then a re-fetch + rate lookup at purchase time. Shippo lets us store the
-- chosen *rate* id directly and buy with a single POST /transactions/, so
-- shippo_rate_id replaces easypost_shipment_id rather than mirroring it.

ALTER TABLE public.orders
  RENAME COLUMN easypost_shipment_id TO shippo_rate_id;

ALTER TABLE public.orders
  RENAME COLUMN easypost_tracking_code TO tracking_number;

ALTER TABLE public.orders
  -- Carrier's own tracking page for this parcel. Comes back from Shippo as
  -- tracking_url_provider; goes straight into the customer's shipping email so
  -- they get a link instead of a number to copy somewhere.
  ADD COLUMN IF NOT EXISTS tracking_url text,
  -- Printable label PDF (Shippo-hosted). Powers the "Print label" button on
  -- the admin order card. Staff-only — see the RPC change below.
  ADD COLUMN IF NOT EXISTS label_url text;

-- get_order_by_token() returns to_jsonb(o), i.e. the whole orders row, so the
-- renames above flow through to guests with no signature change needed. The
-- two *new* columns would flow through too, and neither belongs to the
-- customer: label_url is a live postage label that could be re-printed, and
-- shippo_rate_id is an internal vendor handle. Subtract both.
--
-- Everything else about this function is unchanged from
-- 20260714120000_shinyvault_commerce.sql.
CREATE OR REPLACE FUNCTION public.get_order_by_token(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT (to_jsonb(o) - 'label_url' - 'shippo_rate_id') || jsonb_build_object(
    'items', (SELECT jsonb_agg(to_jsonb(oi)) FROM public.order_items oi WHERE oi.order_id = o.id)
  )
  INTO v_result
  FROM public.orders o
  WHERE o.order_token = p_token;

  RETURN v_result;
END;
$$;

-- create_order()'s 9th parameter is named p_easypost_shipment_id. Postgres
-- refuses to rename an input parameter via CREATE OR REPLACE ("cannot change
-- name of input parameter"), so the old signature has to be dropped outright
-- and recreated. Body is byte-for-byte the version from
-- 20260714150000_shinyvault_order_price_integrity.sql (server-side price
-- lookup, status='active' guard, quantity>0 guard) with only the parameter
-- and the INSERT column renamed.
DROP FUNCTION IF EXISTS public.create_order(
  uuid, text, text, text, jsonb, int, text, text, text, jsonb
);

CREATE FUNCTION public.create_order(
  p_user_id uuid,
  p_guest_email text,
  p_guest_name text,
  p_fulfillment_method text,
  p_shipping_address jsonb,
  p_shipping_rate_cents int,
  p_shipping_carrier text,
  p_shipping_service text,
  p_shippo_rate_id text,
  p_items jsonb  -- [{product_id, quantity}, ...]
)
RETURNS TABLE (order_id uuid, order_token uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_qty int;
  v_name text;
  v_price int;
  v_cost int;
  v_snapshot jsonb := '[]'::jsonb;
  v_subtotal_cents int := 0;
  v_total_cents int;
  v_order_id uuid;
  v_order_token uuid;
  v_updated_rows int;
BEGIN
  IF p_user_id IS NULL AND (p_guest_email IS NULL OR length(p_guest_email) = 0) THEN
    RAISE EXCEPTION 'Guest orders require an email';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(p_items) AS value ORDER BY (value->>'product_id')
  LOOP
    v_qty := (v_item->>'quantity')::int;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Bad quantity for product %', (v_item->>'product_id');
    END IF;

    UPDATE public.products
       SET quantity_available = quantity_available - v_qty
     WHERE id = (v_item->>'product_id')::uuid
       AND status = 'active'
       AND quantity_available >= v_qty
     RETURNING name, price_cents, cost_cents INTO v_name, v_price, v_cost;
    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    IF v_updated_rows = 0 THEN
      RAISE EXCEPTION 'sold_out:%', (v_item->>'product_id');
    END IF;

    v_subtotal_cents := v_subtotal_cents + (v_price * v_qty);
    v_snapshot := v_snapshot || jsonb_build_object(
      'product_id', (v_item->>'product_id')::uuid,
      'name', v_name,
      'price_cents', v_price,
      'cost_cents', v_cost,
      'quantity', v_qty
    );
  END LOOP;

  v_total_cents := v_subtotal_cents + COALESCE(p_shipping_rate_cents, 0);

  INSERT INTO public.orders (
    user_id, guest_email, guest_name, fulfillment_method, shipping_address,
    shipping_rate_cents, shipping_carrier, shipping_service, shippo_rate_id,
    subtotal_cents, total_cents
  ) VALUES (
    p_user_id, p_guest_email, p_guest_name, p_fulfillment_method, p_shipping_address,
    p_shipping_rate_cents, p_shipping_carrier, p_shipping_service, p_shippo_rate_id,
    v_subtotal_cents, v_total_cents
  ) RETURNING id, order_token INTO v_order_id, v_order_token;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_snapshot) AS value
  LOOP
    INSERT INTO public.order_items (order_id, product_id, product_name_snapshot, price_cents_snapshot, cost_cents_snapshot, quantity)
    VALUES (
      v_order_id, (v_item->>'product_id')::uuid, v_item->>'name',
      (v_item->>'price_cents')::int, (v_item->>'cost_cents')::int, (v_item->>'quantity')::int
    );
  END LOOP;

  RETURN QUERY SELECT v_order_id, v_order_token;
END;
$$;

-- DROP took the old grants with it. Guest checkout requires anon EXECUTE
-- (matching 20260714120000_shinyvault_commerce.sql).
GRANT EXECUTE ON FUNCTION public.create_order(
  uuid, text, text, text, jsonb, int, text, text, text, jsonb
) TO anon, authenticated;
