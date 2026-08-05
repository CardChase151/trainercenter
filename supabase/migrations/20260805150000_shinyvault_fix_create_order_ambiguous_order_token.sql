-- Fix: 'column reference "order_token" is ambiguous' on every checkout.
--
-- create_order() declares RETURNS TABLE (order_id uuid, order_token uuid),
-- which puts OUT parameters named order_id/order_token in scope for the whole
-- body. The INSERT then did:
--
--   RETURNING id, order_token INTO v_order_id, v_order_token
--
-- and plpgsql cannot tell whether that bare `order_token` means the OUT
-- parameter or public.orders.order_token. Its default variable_conflict setting
-- is `error`, so it refuses at runtime. In the storefront this surfaced as
-- "column reference "order_token" is ambiguous" when clicking Continue to
-- payment, with no order created and no Stripe session.
--
-- Why it went unnoticed until the first real checkout: the ambiguity is only
-- raised when the INSERT actually executes, and public.orders had never held a
-- single row, so nothing ever got far enough to trip it. The same text is
-- present in 20260714150000 and 20260714120000.
--
-- Qualifying both columns with the target table removes the ambiguity. The OUT
-- parameter names are unchanged because shinyvault-checkout reads
-- order.order_id / order.order_token off the RPC result. The UPDATE ...
-- RETURNING on products is qualified for the same reason (name/price_cents are
-- not currently ambiguous, but the pattern is identical and one rename away
-- from the same failure).
CREATE OR REPLACE FUNCTION public.create_order(
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
     RETURNING products.name, products.price_cents, products.cost_cents
          INTO v_name, v_price, v_cost;
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
  ) RETURNING orders.id, orders.order_token INTO v_order_id, v_order_token;

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
