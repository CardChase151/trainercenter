-- Vendor tagline / catchphrase.
--
-- Short one-line headline that goes under the vendor's name on the
-- holographic shareable card (e.g. "Where every pull tells a story").
-- 60 char cap so it always fits on one line; vendor sets it from the
-- profile edit page.

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS tagline text
  CHECK (tagline IS NULL OR length(tagline) <= 60);
