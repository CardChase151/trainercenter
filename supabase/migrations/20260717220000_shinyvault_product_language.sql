-- Adds a language field to products (English/Japanese presets in the admin
-- UI, with a free-text "add another" for anything beyond those two). Plain
-- text column, not a lookup table — same pattern as volatility, since the
-- set of languages is small and admin-entered, not a fixed taxonomy.
alter table public.products add column language text not null default 'English';
