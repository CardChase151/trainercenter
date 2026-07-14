-- Fixes create_order() trusting client-supplied price_cents/cost_cents.
-- The RPC is granted EXECUTE to anon (guest checkout requires it), so a
-- caller hitting it directly (bypassing the storefront UI) could previously
-- pass any price_cents it wanted and buy a product for a penny. Prices/costs
-- are now looked up server-side from public.products at the same moment
-- stock is decremented, via UPDATE ... RETURNING, so the two can never
-- disagree. p_items only needs {product_id, quantity} now — any price/cost/
-- name fields a caller still sends are ignored.
--
-- Also added: status = 'active' guard (can't buy a draft/archived product
-- via a raw RPC call even though the storefront never lists one) and a
-- quantity > 0 guard.
CREATE OR REPLACE FUNCTION public.create_order(
  p_user_id uuid,
  p_guest_email text,
  p_guest_name text,
  p_fulfillment_method text,
  p_shipping_address jsonb,
  p_shipping_rate_cents int,
  p_shipping_carrier text,
  p_shipping_service text,
  p_easypost_shipment_id text,
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
    shipping_rate_cents, shipping_carrier, shipping_service, easypost_shipment_id,
    subtotal_cents, total_cents
  ) VALUES (
    p_user_id, p_guest_email, p_guest_name, p_fulfillment_method, p_shipping_address,
    p_shipping_rate_cents, p_shipping_carrier, p_shipping_service, p_easypost_shipment_id,
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

-- ─── increment_product_stock ────────────────────────────────
-- Releases inventory create_order() held when a Checkout Session expires
-- unpaid (see shinyvault-stripe-webhook). Service-role only — Postgres
-- grants EXECUTE to PUBLIC on every new function by default, which here
-- would let anon/authenticated inflate stock arbitrarily, so it's revoked
-- immediately after creation. The webhook calls this with the service role
-- key, which bypasses grants entirely, same as it bypasses RLS.
CREATE OR REPLACE FUNCTION public.increment_product_stock(p_product_id uuid, p_quantity int)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.products SET quantity_available = quantity_available + p_quantity WHERE id = p_product_id;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_product_stock(uuid, int) FROM PUBLIC;
