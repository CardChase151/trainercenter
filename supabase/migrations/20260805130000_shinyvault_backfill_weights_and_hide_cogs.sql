-- 1. Backfill shipping weight/dimensions on products that have none.
--
-- Every product created through the bulk upload wizard landed with weight_oz
-- NULL, because that wizard never collected it (fixed alongside this migration
-- in src/pages/admin/BulkUploadPage.js). The checkout rate quote falls back to
-- 4oz for an unweighed product, which underquotes sealed product badly — a
-- booster box is closer to 28oz — and the carrier bills the shortfall back to
-- the shop after the label has already been sold at the wrong price. 66 of the
-- 71 active products were sealed, so this was live on nearly the whole catalog.
--
-- Values mirror src/lib/shippingDefaults.js and err high on purpose: an
-- overquote costs the customer a little, an underquote costs the shop silently.
-- Sealed is a wide range (single pack ~1oz, booster box ~24oz, case ~200oz), so
-- these are a starting point to correct with a scale, not a substitute for one.
UPDATE public.products p
   SET weight_oz = d.weight_oz,
       length_in = COALESCE(p.length_in, d.length_in),
       width_in  = COALESCE(p.width_in,  d.width_in),
       height_in = COALESCE(p.height_in, d.height_in)
  FROM (
    VALUES
      ('single',     2::numeric,  6::numeric,  4::numeric, 0.5::numeric),
      ('sealed',    28::numeric, 12::numeric,  9::numeric, 4::numeric),
      ('accessory',  8::numeric,  9::numeric,  6::numeric, 3::numeric),
      ('other',      6::numeric,  9::numeric,  6::numeric, 2::numeric)
  ) AS d(kind, weight_oz, length_in, width_in, height_in)
  LEFT JOIN public.categories c ON c.kind = d.kind
 WHERE p.weight_oz IS NULL
   AND (p.category_id = c.id OR (p.category_id IS NULL AND d.kind = 'other'));

-- 2. Stop leaking cost of goods to customers.
--
-- get_order_by_token() returned to_jsonb(oi) for each order item, and
-- order_items carries cost_cents_snapshot — what the shop paid. The RPC is
-- granted EXECUTE to anon (guest order lookup needs it), so any buyer holding
-- their own order token could read the shop's margin on every line item.
-- Nothing in the UI ever displayed it; it was just riding along in the payload.
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
    'items', (
      SELECT jsonb_agg(to_jsonb(oi) - 'cost_cents_snapshot')
        FROM public.order_items oi
       WHERE oi.order_id = o.id
    )
  )
  INTO v_result
  FROM public.orders o
  WHERE o.order_token = p_token;

  RETURN v_result;
END;
$$;
