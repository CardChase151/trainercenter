-- Members were originally created with only first_name. Add last_name so the
-- account record matches the rest of the site (vendors collect a full name).
ALTER TABLE public.members ADD COLUMN last_name text;
