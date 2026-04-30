-- Split vendor names into first_name + last_name columns. Keep `name` as a
-- denormalized full-name field so existing display code (admin, public feed,
-- emails) keeps working without refactor. Form collects both inputs and
-- writes all three on save.

ALTER TABLE public.vendors
  ADD COLUMN first_name text,
  ADD COLUMN last_name text;

UPDATE public.vendors
SET
  first_name = split_part(name, ' ', 1),
  last_name = NULLIF(trim(substring(name FROM position(' ' IN name) + 1)), '')
WHERE name IS NOT NULL AND first_name IS NULL;
