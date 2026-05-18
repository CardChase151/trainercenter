-- One-click vendor response tokens.
--
-- Adds a stable per-vendor token (analogous to marketing_contacts.unsubscribe_token)
-- so drip emails can carry tokenized URLs like:
--   https://pokemontrainercenter.com/vendors/respond?token=XXX&event=YYY&action=not_interested
--   https://pokemontrainercenter.com/vendors/respond?token=XXX&event=YYY&action=cancel
--
-- The vendor-event-respond edge function verifies the token and performs the
-- same DB write the vendor would do from their logged-in dashboard. No login
-- needed — clicking from email completes the action in one tap (cancel adds a
-- reason form before submit).
--
-- Done in 4 steps (not just `ADD COLUMN ... NOT NULL DEFAULT`) so existing
-- rows get backfilled with unique uuids before the UNIQUE constraint locks in.

ALTER TABLE public.vendors ADD COLUMN response_token uuid;

UPDATE public.vendors
  SET response_token = gen_random_uuid()
  WHERE response_token IS NULL;

ALTER TABLE public.vendors
  ALTER COLUMN response_token SET DEFAULT gen_random_uuid(),
  ALTER COLUMN response_token SET NOT NULL;

ALTER TABLE public.vendors
  ADD CONSTRAINT vendors_response_token_key UNIQUE (response_token);
