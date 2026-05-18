-- Staff-curated experience rating for vendors.
--
-- Different from vendors.experience_level (vendor self-reports show count
-- on signup). This is the staff's own assessment — set/changed from the
-- /staff/vendors dashboard, visible to all admins, but doesn't override
-- the vendor's self-report.
--
-- Five tiers with color coding in the UI:
--   beginner, novice, intermediate, advanced, expert
-- NULL = unrated.

ALTER TABLE public.vendors
  ADD COLUMN staff_experience_rating text
  CHECK (staff_experience_rating IS NULL OR staff_experience_rating IN (
    'beginner', 'novice', 'intermediate', 'advanced', 'expert'
  ));
