-- Instagram contacts: a staff-only address book of every account that
-- follows @trainercenter.pokemon (and every account we follow). Seeded
-- one-time from the IG data export at instagram-archive/. Kept separate
-- from marketing_contacts because IG handles aren't email-keyed and
-- most followers will never have an email on file.
--
-- Staff workflow: tag each handle as member / vendor / influencer as
-- they go, then click "Open IG" to message that person directly.

CREATE TABLE public.ig_contacts (
  handle text PRIMARY KEY,
  profile_url text,

  -- 'follower' = they follow us
  -- 'following' = we follow them
  -- 'mutual' = both
  relationship text NOT NULL DEFAULT 'follower'
    CHECK (relationship IN ('follower', 'following', 'mutual')),

  -- IG-reported timestamp of the follow event (epoch seconds in the
  -- export, stored as a real timestamptz).
  followed_at timestamptz,

  -- Single staff-assigned classification. NULL until someone tags it.
  tag text
    CHECK (tag IS NULL OR tag IN ('member', 'vendor', 'influencer')),

  notes text,
  last_contacted_at timestamptz,
  contacted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Optional links to existing records once a handle is matched to a
  -- real person. All nullable; matching is manual.
  marketing_contact_id uuid REFERENCES public.marketing_contacts(id) ON DELETE SET NULL,
  member_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Lowercase handle for case-insensitive sort + alpha jump-bar grouping.
CREATE INDEX ig_contacts_handle_lower_idx
  ON public.ig_contacts ((lower(handle)));

CREATE INDEX ig_contacts_tag_idx
  ON public.ig_contacts (tag)
  WHERE tag IS NOT NULL;

CREATE INDEX ig_contacts_relationship_idx
  ON public.ig_contacts (relationship);

-- Keep updated_at fresh on every row mutation.
CREATE OR REPLACE FUNCTION public.touch_ig_contacts_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER ig_contacts_set_updated_at
  BEFORE UPDATE ON public.ig_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_ig_contacts_updated_at();

ALTER TABLE public.ig_contacts ENABLE ROW LEVEL SECURITY;

-- Staff-only on every operation. Matches the public.is_admin() helper
-- introduced in 20260410170000_fix_profiles_rls_recursion.sql.
CREATE POLICY "Admins can read ig_contacts"
  ON public.ig_contacts
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can insert ig_contacts"
  ON public.ig_contacts
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update ig_contacts"
  ON public.ig_contacts
  FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete ig_contacts"
  ON public.ig_contacts
  FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));
