-- ShinyVault seed/demo data — populates the storefront and admin so it's
-- not staring at an empty grid while building/testing. Everything here is
-- status='draft' (not status='active'), so none of it is publicly visible
-- or purchasable until an admin reviews it in /admin/products and flips it
-- live — these are placeholder listings with round test numbers, not real
-- inventory or real prices. Safe to delete wholesale once real stock exists
-- (categories are reused by real products via category_id, so keep those).
INSERT INTO public.categories (name, slug, sort_order) VALUES
  ('Singles', 'singles', 1),
  ('Sealed Product', 'sealed-product', 2),
  ('Vintage', 'vintage', 3),
  ('Accessories', 'accessories', 4)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.products (category_id, name, slug, description, cost_cents, price_cents, quantity_available, volatility, status)
SELECT c.id, p.name, p.slug, p.description, p.cost_cents, p.price_cents, p.quantity_available, p.volatility, 'draft'
FROM (VALUES
  ('singles', 'SEED — Charizard ex Special Illustration Rare', 'seed-charizard-ex-sir', 'Placeholder listing — replace cost/price/photos with a real card before publishing.', 45000, 65000, 1, 'volatile'),
  ('singles', 'SEED — Pikachu VMAX Rainbow Rare', 'seed-pikachu-vmax-rainbow', 'Placeholder listing — replace cost/price/photos with a real card before publishing.', 8000, 12000, 2, 'volatile'),
  ('sealed-product', 'SEED — Scarlet & Violet Booster Box', 'seed-sv-booster-box', 'Placeholder listing — replace cost/price with real sealed product before publishing.', 12000, 14500, 4, 'moderate'),
  ('sealed-product', 'SEED — Elite Trainer Box', 'seed-etb', 'Placeholder listing — replace cost/price with real sealed product before publishing.', 3500, 4500, 6, 'moderate'),
  ('vintage', 'SEED — Base Set Blastoise (Near Mint)', 'seed-base-set-blastoise', 'Placeholder listing — replace cost/price/photos with a real graded/raw card before publishing.', 20000, 30000, 1, 'moderate'),
  ('accessories', 'SEED — Toploader 20-pack', 'seed-toploader-20pack', 'Placeholder listing — replace cost/price with real accessory stock before publishing.', 400, 899, 25, 'stable')
) AS p(cat_slug, name, slug, description, cost_cents, price_cents, quantity_available, volatility)
JOIN public.categories c ON c.slug = p.cat_slug
ON CONFLICT (slug) DO NOTHING;
