-- ShinyVault commerce schema — new TCG online store owned by Trainer Center,
-- sharing this Supabase project so a future second storefront (Trainer
-- Center's own site) can read/write the same catalog and stock without a
-- schema migration. Tables are deliberately brand-neutral (no shinyvault_
-- prefix on the shared catalog/order tables) — same pattern as
-- marketing_contacts.source, a free-text channel tag with no CHECK
-- constraint so new storefronts are a data addition, not a DDL change.
--
-- Reuses public.is_admin(auth.uid()) (already granted to authenticated,
-- anon) and public.set_updated_at() (both defined in
-- 20260430183000_vendor_system_initial.sql) — not redefined here.

-- ─── 1. categories ──────────────────────────────────────────
CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER categories_set_updated_at
  BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 2. products ────────────────────────────────────────────
-- No 'sold_out' status stored — derived in queries/UI from
-- quantity_available <= 0 AND status = 'active', so it can never drift out
-- of sync with actual stock the way a stored flag would when restocked.
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  cost_cents int NOT NULL DEFAULT 0,
  price_cents int NOT NULL,
  quantity_available int NOT NULL DEFAULT 0 CHECK (quantity_available >= 0),
  volatility text NOT NULL DEFAULT 'stable' CHECK (volatility IN ('stable', 'moderate', 'volatile')),
  price_checked_at timestamptz,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  weight_oz numeric,
  length_in numeric,
  width_in numeric,
  height_in numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX products_category_id_idx ON public.products(category_id);
CREATE INDEX products_status_idx ON public.products(status);
CREATE INDEX products_volatility_idx ON public.products(volatility);

CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 3. product_media ───────────────────────────────────────
CREATE TABLE public.product_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('photo', 'video')),
  storage_path text,
  bunny_video_id text,
  bunny_playback_url text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX product_media_product_id_idx ON public.product_media(product_id);

-- ─── 4. shipping_boxes ──────────────────────────────────────
-- Admin-editable packaging options so the rate-shopping edge function has
-- something to sum cart item weights against and pick the smallest fit
-- from. Seeded below with starter sizes.
CREATE TABLE public.shipping_boxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  weight_oz_max numeric NOT NULL,
  length_in numeric NOT NULL,
  width_in numeric NOT NULL,
  height_in numeric NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.shipping_boxes (name, weight_oz_max, length_in, width_in, height_in) VALUES
  ('Bubble mailer', 8, 9, 6, 1),
  ('Small box', 24, 8, 6, 4),
  ('Medium box', 64, 12, 9, 6),
  ('Large box', 160, 16, 12, 10);

-- ─── 5. orders ──────────────────────────────────────────────
-- order_token is the guest lookup credential — deliberately NOT exposed via
-- an RLS policy (a policy like "USING (order_token IS NOT NULL)" would leak
-- every guest order to any anonymous caller, since RLS gates row
-- visibility, not "did the caller supply the right token"). Guest lookup
-- goes through get_order_by_token() below instead.
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  guest_email text,
  guest_name text,
  order_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  storefront text NOT NULL DEFAULT 'shinyvault',
  fulfillment_method text CHECK (fulfillment_method IN ('ship', 'pickup')),
  shipping_address jsonb,
  shipping_rate_cents int,
  shipping_carrier text,
  shipping_service text,
  easypost_shipment_id text,
  easypost_tracking_code text,
  subtotal_cents int NOT NULL,
  total_cents int NOT NULL,
  stripe_customer_id text,
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'expired', 'refunded', 'failed')),
  fulfillment_status text NOT NULL DEFAULT 'unfulfilled' CHECK (fulfillment_status IN ('unfulfilled', 'label_purchased', 'shipped', 'ready_for_pickup', 'picked_up', 'completed')),
  receipt_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX orders_user_id_idx ON public.orders(user_id);
CREATE INDEX orders_payment_status_idx ON public.orders(payment_status);
CREATE INDEX orders_stripe_checkout_session_id_idx ON public.orders(stripe_checkout_session_id);

CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 6. order_items ─────────────────────────────────────────
-- Snapshots the name/price/cost at time of sale so profit reporting stays
-- accurate even if the product is later edited or archived.
CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name_snapshot text NOT NULL,
  price_cents_snapshot int NOT NULL,
  cost_cents_snapshot int NOT NULL,
  quantity int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_items_order_id_idx ON public.order_items(order_id);
CREATE INDEX order_items_product_id_idx ON public.order_items(product_id);

-- ─── 7. RLS: categories ─────────────────────────────────────
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view categories"
  ON public.categories FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "Admins can manage categories"
  ON public.categories FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- ─── 8. RLS: products ───────────────────────────────────────
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view active products"
  ON public.products FOR SELECT TO anon, authenticated
  USING (status = 'active');

CREATE POLICY "Admins can view all products"
  ON public.products FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can manage products"
  ON public.products FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- ─── 9. RLS: product_media ──────────────────────────────────
ALTER TABLE public.product_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view media of active products"
  ON public.product_media FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND p.status = 'active'));

CREATE POLICY "Admins can manage product media"
  ON public.product_media FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- ─── 10. RLS: shipping_boxes ────────────────────────────────
ALTER TABLE public.shipping_boxes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view active shipping boxes"
  ON public.shipping_boxes FOR SELECT TO anon, authenticated
  USING (active = true);

CREATE POLICY "Admins can manage shipping boxes"
  ON public.shipping_boxes FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- ─── 11. RLS: orders ────────────────────────────────────────
-- No INSERT policy for anyone — order creation only happens through the
-- create_order() SECURITY DEFINER RPC below. No DELETE policy ever — orders
-- are financial records, only status-transitioned.
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers can view own orders"
  ON public.orders FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can view all orders"
  ON public.orders FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update orders"
  ON public.orders FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- ─── 12. RLS: order_items ───────────────────────────────────
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers can view own order items"
  ON public.order_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND o.user_id = auth.uid()));

CREATE POLICY "Admins can view all order items"
  ON public.order_items FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

-- ─── 13. RPC: create_order ──────────────────────────────────
-- Atomically re-checks and decrements stock for every line item, then
-- inserts the order + items, all in one transaction. Locks items in a
-- stable order_by product_id to avoid deadlocks between two concurrent
-- multi-item checkouts. If any item is out of stock the whole call raises
-- and nothing is written — the caller shows "someone just bought the last
-- one" before Stripe is ever touched.
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
  p_items jsonb  -- [{product_id, quantity, price_cents, cost_cents, name}, ...]
)
RETURNS TABLE (order_id uuid, order_token uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_subtotal_cents int := 0;
  v_total_cents int;
  v_order_id uuid;
  v_order_token uuid;
  v_updated_rows int;
BEGIN
  IF p_user_id IS NULL AND (p_guest_email IS NULL OR length(p_guest_email) = 0) THEN
    RAISE EXCEPTION 'Guest orders require an email';
  END IF;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(p_items) AS value ORDER BY (value->>'product_id')
  LOOP
    UPDATE public.products
       SET quantity_available = quantity_available - (v_item->>'quantity')::int
     WHERE id = (v_item->>'product_id')::uuid
       AND quantity_available >= (v_item->>'quantity')::int;
    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    IF v_updated_rows = 0 THEN
      RAISE EXCEPTION 'sold_out:%', (v_item->>'product_id');
    END IF;
    v_subtotal_cents := v_subtotal_cents + ((v_item->>'price_cents')::int * (v_item->>'quantity')::int);
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

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS value
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

GRANT EXECUTE ON FUNCTION public.create_order(uuid, text, text, text, jsonb, int, text, text, text, jsonb) TO authenticated, anon;

-- ─── 14. RPC: get_order_by_token ────────────────────────────
-- Guest order lookup. The token comparison happens inside the function
-- (not via RLS) so an anonymous caller can only ever see the one order
-- whose token they actually have.
CREATE OR REPLACE FUNCTION public.get_order_by_token(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT to_jsonb(o) || jsonb_build_object(
    'items', (SELECT jsonb_agg(to_jsonb(oi)) FROM public.order_items oi WHERE oi.order_id = o.id)
  )
  INTO v_result
  FROM public.orders o
  WHERE o.order_token = p_token;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_order_by_token(uuid) TO anon, authenticated;

-- ─── 15. Storage bucket: shinyvault-media ───────────────────
-- Public product photos/video-adjacent assets. Simpler than vendor-media —
-- no per-owner ownership concept, every product is store-owned, so it's
-- just "admins write, public reads."
INSERT INTO storage.buckets (id, name, public)
VALUES ('shinyvault-media', 'shinyvault-media', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read shinyvault-media"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'shinyvault-media');

CREATE POLICY "Admins manage shinyvault-media"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'shinyvault-media' AND public.is_admin(auth.uid()))
  WITH CHECK (bucket_id = 'shinyvault-media' AND public.is_admin(auth.uid()));
