-- ShinyVault customer-area hub: wishlist + special requests ("looking for")
-- ------------------------------------------------------------------------
-- Adds the two tables behind the new tabbed customer area. Everything the
-- customer can build lives here; the *connecting* pieces (Resend email send,
-- live-market pricing, real fuzzy match scoring) are deliberately NOT here yet
-- and are stubbed in the app with TODOs — see shineyvault/PLAN.md "Planned
-- next: Customer area hub". The columns below (price_cents_at_add, matched_*,
-- notified_at) exist now so those later layers plug in without another
-- migration.
--
-- Reuses public.is_admin(auth.uid()) and the same RLS shape as the commerce
-- migration (20260714120000). Backend of record for this Supabase project is
-- the trainercenter repo, so this file lives here.

-- ─── wishlist_items ─────────────────────────────────────────
-- One row per (customer, product) they saved. price_cents_at_add is the
-- baseline a future price-drop notifier diffs against.
CREATE TABLE IF NOT EXISTS public.wishlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  price_cents_at_add int,
  notify_on_drop boolean NOT NULL DEFAULT true,
  notify_on_restock boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS wishlist_items_user_idx ON public.wishlist_items(user_id);
CREATE INDEX IF NOT EXISTS wishlist_items_product_idx ON public.wishlist_items(product_id);

-- ─── want_list_items (special requests / "looking for") ─────
-- raw_text is the free-form ask; the structured hints are optional and drive
-- the (currently dumb, client-side) admin match surface. status flow:
--   open -> matched (admin found it) -> fulfilled (customer got it)
--   open -> cancelled (customer withdrew)
-- notified_at stays NULL until the customer email actually sends — that path
-- is stubbed until Resend is connected (see PLAN.md).
CREATE TABLE IF NOT EXISTS public.want_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  raw_text text NOT NULL,
  card_name text,
  set_name text,
  condition text,
  max_price_cents int,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'matched', 'fulfilled', 'cancelled')),
  matched_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  matched_at timestamptz,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS want_list_items_user_idx ON public.want_list_items(user_id);
CREATE INDEX IF NOT EXISTS want_list_items_status_idx ON public.want_list_items(status);

-- ─── RLS: wishlist_items ────────────────────────────────────
ALTER TABLE public.wishlist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers manage own wishlist"
  ON public.wishlist_items FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Admins can read wishlists (demand signal); no write.
CREATE POLICY "Admins can view wishlists"
  ON public.wishlist_items FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

-- ─── RLS: want_list_items ───────────────────────────────────
ALTER TABLE public.want_list_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers manage own requests"
  ON public.want_list_items FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can view all requests"
  ON public.want_list_items FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

-- Admins mark requests matched/fulfilled and (later) notified. Cannot change
-- ownership: user_id must stay put.
CREATE POLICY "Admins can update requests"
  ON public.want_list_items FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
