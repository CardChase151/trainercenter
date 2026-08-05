-- Refine the sealed-product weight backfill by product name.
--
-- 20260805130000 backfilled every sealed product at a flat 28oz, keyed only on
-- category kind. "Sealed Product" spans a 1oz booster pack and a 38oz booster
-- box — a 35x range — so a single number is wrong at both ends. Worst case in
-- the current catalog was the $1 Surging Sparks Booster Pack quoting as a 28oz
-- parcel ($6.40 of shipping on a 1oz item; $5.17 after this).
--
-- Patterns and values mirror SEALED_PATTERNS in src/lib/shippingDefaults.js;
-- keep the two in sync. Order matters: 'booster box' is matched before
-- 'booster pack' so the narrower phrase wins.
--
-- Only touches rows still sitting at the flat 28oz default, so anything since
-- corrected by hand on the product edit page is left alone.
UPDATE public.products p
   SET weight_oz = v.weight_oz,
       length_in = v.length_in,
       width_in  = v.width_in,
       height_in = v.height_in
  FROM (
    SELECT id,
           CASE
             WHEN name ~* 'booster box'                          THEN 38
             WHEN name ~* 'elite trainer box|\yetb\y'             THEN 32
             WHEN name ~* 'tin\y|collection box|premium collection' THEN 18
             WHEN name ~* 'booster bundle|build ?& ?battle'       THEN 12
             WHEN name ~* 'booster pack|blister|sleeved pack'      THEN 3
           END AS weight_oz,
           CASE
             WHEN name ~* 'booster box'                          THEN 15
             WHEN name ~* 'elite trainer box|\yetb\y'             THEN 15
             WHEN name ~* 'tin\y|collection box|premium collection' THEN 10
             WHEN name ~* 'booster bundle|build ?& ?battle'       THEN 12
             WHEN name ~* 'booster pack|blister|sleeved pack'      THEN 7
           END AS length_in,
           CASE
             WHEN name ~* 'booster pack|blister|sleeved pack'      THEN 5
             ELSE 8
           END AS width_in,
           CASE
             WHEN name ~* 'booster box'                          THEN 5
             WHEN name ~* 'elite trainer box|\yetb\y'             THEN 4
             WHEN name ~* 'tin\y|collection box|premium collection' THEN 3
             WHEN name ~* 'booster bundle|build ?& ?battle'       THEN 3
             WHEN name ~* 'booster pack|blister|sleeved pack'      THEN 0.75
           END AS height_in
      FROM public.products
     WHERE weight_oz = 28
  ) AS v
 WHERE p.id = v.id
   AND v.weight_oz IS NOT NULL;
