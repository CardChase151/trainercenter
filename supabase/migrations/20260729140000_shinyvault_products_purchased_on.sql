-- ShinyVault: internal acquisition date on products (2026-07-29)
-- Distinct from created_at (when the listing was uploaded to the store).
-- purchased_on is the calendar date we actually bought the item, for
-- internal inventory/aging use only — never surfaced to customers.
alter table public.products
  add column if not exists purchased_on date;

comment on column public.products.purchased_on is
  'Internal acquisition date — the calendar date we bought this item. Not public-facing; for internal inventory/aging analysis. Distinct from created_at (listing upload time).';
