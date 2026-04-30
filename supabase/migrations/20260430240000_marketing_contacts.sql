-- Marketing contacts: a single list of everyone we can email/text for
-- Vendor Day promotion and store-return reminders. Sourced from Square
-- (initial bulk + ongoing sync) and from React app signups (members and
-- vendors). NOT linked to auth.users -- existence here creates zero
-- friction for someone signing up for a real account later.

CREATE TABLE public.marketing_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Natural identity
  email text NOT NULL,
  first_name text,
  last_name text,
  phone text,

  -- Where this contact came from. App signups link via member_id/vendor_id;
  -- Square syncs key on square_customer_id.
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('square', 'app_member', 'app_vendor', 'manual')),
  square_customer_id text,
  member_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,

  -- Subscription state. is_subscribed=false MUST always win; the Square
  -- sync should never flip false back to true.
  is_subscribed boolean NOT NULL DEFAULT true,
  unsubscribed_at timestamptz,
  unsubscribe_reason text,
  unsubscribe_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),

  -- Open-ended segmentation for later (e.g. 'vendor_day_attendee').
  tags text[] NOT NULL DEFAULT ARRAY[]::text[],

  -- Timestamps
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Email is the natural key. Stored lowercased on the application side;
  -- enforce uniqueness here. Allow NULL for phone-only contacts.
  CONSTRAINT marketing_contacts_email_lower CHECK (email = lower(email))
);

CREATE UNIQUE INDEX marketing_contacts_email_uq
  ON public.marketing_contacts (email);

CREATE UNIQUE INDEX marketing_contacts_square_customer_id_uq
  ON public.marketing_contacts (square_customer_id)
  WHERE square_customer_id IS NOT NULL;

CREATE INDEX marketing_contacts_subscribed_idx
  ON public.marketing_contacts (is_subscribed)
  WHERE is_subscribed = true;

CREATE INDEX marketing_contacts_source_idx
  ON public.marketing_contacts (source);

CREATE INDEX marketing_contacts_tags_idx
  ON public.marketing_contacts USING GIN (tags);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.marketing_contacts_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER marketing_contacts_updated_at
  BEFORE UPDATE ON public.marketing_contacts
  FOR EACH ROW EXECUTE FUNCTION public.marketing_contacts_set_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────
-- Locked down by default. Admins can manage; everyone else has zero
-- access to the table directly. Unsubscribe goes through a public RPC
-- that bypasses RLS via SECURITY DEFINER (defined below).
ALTER TABLE public.marketing_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read marketing contacts"
  ON public.marketing_contacts
  FOR SELECT
  TO authenticated
  USING (
    COALESCE((auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean, false) = true
  );

CREATE POLICY "Admins can write marketing contacts"
  ON public.marketing_contacts
  FOR ALL
  TO authenticated
  USING (
    COALESCE((auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean, false) = true
  )
  WITH CHECK (
    COALESCE((auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean, false) = true
  );

-- App-signup hooks: a SECURITY DEFINER upsert function so members and
-- vendors can self-add to the list on signup without needing direct
-- table-write RLS.
CREATE OR REPLACE FUNCTION public.upsert_marketing_contact_from_app(
  p_email text,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_source text,
  p_member_id uuid,
  p_vendor_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RETURN;
  END IF;
  v_email := lower(trim(p_email));

  IF p_source NOT IN ('app_member', 'app_vendor') THEN
    RAISE EXCEPTION 'Invalid source % for app upsert', p_source;
  END IF;

  INSERT INTO public.marketing_contacts (
    email, first_name, last_name, phone, source, member_id, vendor_id
  )
  VALUES (
    v_email, p_first_name, p_last_name, p_phone, p_source, p_member_id, p_vendor_id
  )
  ON CONFLICT (email) DO UPDATE SET
    -- Fill in missing fields, but don't overwrite non-null with null.
    first_name  = COALESCE(public.marketing_contacts.first_name, EXCLUDED.first_name),
    last_name   = COALESCE(public.marketing_contacts.last_name,  EXCLUDED.last_name),
    phone       = COALESCE(public.marketing_contacts.phone,      EXCLUDED.phone),
    -- Link to app rows if they exist.
    member_id   = COALESCE(public.marketing_contacts.member_id,  EXCLUDED.member_id),
    vendor_id   = COALESCE(public.marketing_contacts.vendor_id,  EXCLUDED.vendor_id),
    -- Source: keep 'square' if it was square; otherwise upgrade to whichever app role.
    source      = CASE
      WHEN public.marketing_contacts.source = 'square'
        THEN public.marketing_contacts.source
      ELSE EXCLUDED.source
    END,
    updated_at  = now();
    -- Critically: NEVER touch is_subscribed here. If they unsubscribed,
    -- they stay unsubscribed.
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_marketing_contact_from_app(
  text, text, text, text, text, uuid, uuid
) TO authenticated, anon;

-- Public unsubscribe via token. SECURITY DEFINER so the anon role can
-- flip the row without the table being readable.
CREATE OR REPLACE FUNCTION public.unsubscribe_marketing_contact(
  p_token uuid,
  p_reason text DEFAULT NULL
)
RETURNS TABLE (email text, first_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.marketing_contacts
     SET is_subscribed = false,
         unsubscribed_at = now(),
         unsubscribe_reason = p_reason,
         updated_at = now()
   WHERE unsubscribe_token = p_token
   RETURNING marketing_contacts.email, marketing_contacts.first_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unsubscribe_marketing_contact(uuid, text) TO anon, authenticated;

-- Optional: lookup-by-token for the unsubscribe page so we can show
-- "Hey [first name], unsubscribe [email]?" before they confirm.
CREATE OR REPLACE FUNCTION public.lookup_marketing_contact_by_token(p_token uuid)
RETURNS TABLE (email text, first_name text, is_subscribed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT mc.email, mc.first_name, mc.is_subscribed
    FROM public.marketing_contacts mc
   WHERE mc.unsubscribe_token = p_token;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_marketing_contact_by_token(uuid) TO anon, authenticated;
