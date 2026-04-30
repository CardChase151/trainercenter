-- Phase 2 of marketing_contacts: recurring Square sync.
--
-- Pieces:
--  1. sync_state: tiny generic key/value table for tracking integration
--     watermarks. Used here for "last successful Square customer sync".
--  2. pg_cron + pg_net extensions: scheduled HTTP-triggered jobs.
--  3. Cron job: hits the square-customer-sync edge function once per day.
--  4. Square Access Token: stored in Supabase Vault (NOT in this file --
--     the secret is created via vault.create_secret() at runtime; this
--     migration only creates the public RPC that reads it).
--  5. get_square_access_token RPC: SECURITY DEFINER, service_role-only,
--     reads the decrypted secret from the vault. The edge function calls
--     this on each invocation so the token is rotatable without redeploys
--     and never appears in code or env.

CREATE TABLE IF NOT EXISTS public.sync_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage sync_state"
  ON public.sync_state FOR ALL TO authenticated
  USING (COALESCE((auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean, false) = true)
  WITH CHECK (COALESCE((auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean, false) = true);

-- Bootstrap: Phase 1 just imported everything, so "last sync" is now.
INSERT INTO public.sync_state (key, value)
VALUES ('square_customers_last_sync', jsonb_build_object('last_sync_at', now()))
ON CONFLICT (key) DO NOTHING;

-- Extensions for HTTP-triggered cron.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- RPC the edge function uses to read the Square token from vault.
-- The vault secret itself ('square_access_token') is created via
-- vault.create_secret() out-of-band, not in a migration, so this migration
-- file is safe to commit.
CREATE OR REPLACE FUNCTION public.get_square_access_token()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE v_token text;
BEGIN
  SELECT decrypted_secret INTO v_token
    FROM vault.decrypted_secrets
   WHERE name = 'square_access_token'
   ORDER BY created_at DESC
   LIMIT 1;
  RETURN v_token;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_square_access_token() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_square_access_token() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_square_access_token() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_square_access_token() TO service_role;

-- Schedule the daily Square sync at 10:00 UTC (3am PT).
-- The Authorization header uses the project's anon JWT (it's the same key
-- that ships in the public React bundle, not a secret). The edge function
-- runs with verify_jwt=true so anon-key auth is accepted; inside the
-- function it uses its own SUPABASE_SERVICE_ROLE_KEY env to do privileged
-- DB work.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'square-customer-sync-daily') THEN
    PERFORM cron.schedule(
      'square-customer-sync-daily',
      '0 10 * * *',
      $JOB$
      SELECT net.http_post(
        url := 'https://tfneuzbhiqsdvnhhdfsw.supabase.co/functions/v1/square-customer-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmbmV1emJoaXFzZHZuaGhkZnN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2NzcwNTEsImV4cCI6MjA5MDI1MzA1MX0.L90y9Cy1QeSQLkql3O8gaHSbGNIQ-NXjIM6hdzFEVf0'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      ) AS request_id;
      $JOB$
    );
  END IF;
END$$;
