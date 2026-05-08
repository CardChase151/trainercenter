-- Calendar event descriptions are now produced by the TipTap rich-text
-- editor in the staff EventModal — pure HTML, sanitized at render time
-- via DOMPurify with a tight allowlist. Existing rows store plain text
-- (sometimes with bare URLs and double-newline paragraphs). This
-- migration converts the legacy plain-text descriptions to the new HTML
-- shape so the day-detail card renders them correctly going forward.
--
-- Idempotent: each step skips rows already containing the markup it
-- would otherwise add, so re-running this migration is a safe no-op.

-- 1. Auto-link bare http(s) URLs that aren't already inside an <a> tag.
UPDATE public.events
SET description = regexp_replace(
      description,
      '(https?://[^[:space:]<]+)',
      '<a href="\1" target="_blank" rel="noopener noreferrer">\1</a>',
      'g'
    )
WHERE description IS NOT NULL
  AND description ~ 'https?://'
  AND description !~ '<a ';

-- 2. Wrap plain-text descriptions in paragraph + line-break HTML so the
--    visual line layout the user typed survives. Skip rows that already
--    have <p> tags (they were already migrated or were authored as HTML).
UPDATE public.events
SET description = '<p>'
  || replace(replace(description, E'\n\n', E'</p><p>'), E'\n', '<br>')
  || '</p>'
WHERE description IS NOT NULL
  AND length(trim(description)) > 0
  AND description !~ '<p>';
