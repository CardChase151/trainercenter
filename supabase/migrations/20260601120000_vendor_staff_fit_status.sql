-- Staff "fit" assessment per vendor — internal signal that lives on the
-- /staff/vendors cards. Independent of staff_experience_rating (which is a
-- five-tier skill assessment); this one is binary "yes / no" gut check
-- with an explanation.
--
-- 'favorite' → green badge "Favorite Vendor"
-- 'not_fit'  → red badge "Not a Fit"
-- NULL       → no badge
--
-- staff_fit_reason holds the WHY. Tapping the badge in the UI opens it.
-- Existing admin UPDATE policy on public.vendors already lets staff write
-- these columns — no new policy needed.

ALTER TABLE public.vendors
  ADD COLUMN staff_fit_status text
  CHECK (staff_fit_status IS NULL OR staff_fit_status IN ('favorite', 'not_fit'));

ALTER TABLE public.vendors
  ADD COLUMN staff_fit_reason text;
