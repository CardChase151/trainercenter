-- Vendor system: tables for vendor profiles, per-event applications,
-- check-ins (with geo verification), post-event submissions, and media.
--
-- Auth model: vendor logs in via Supabase magic-link auth; vendors.user_id
-- links the vendor profile row to auth.users. Staff/admin uses the existing
-- profiles.is_admin flag (no changes needed there).
--
-- Categories: 'vendor_day' is a new value for events.category. The events
-- table itself is unchanged (category is already a free-text column).

-- ─── 1. Vendors ───────────────────────────────────────────
-- One row per vendor. Created on first application; updated as their profile
-- evolves. status reflects overall standing in the program.
CREATE TABLE public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL UNIQUE,
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  ig_handle text,
  tiktok_handle text,
  fb_handle text,
  specialty text,
  bio text,
  avatar_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'suspended')),
  heard_from text,
  referred_by_vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  referred_by_name text,
  referred_by_contact text,
  referred_by_handle text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX vendors_user_id_idx ON public.vendors(user_id);
CREATE INDEX vendors_status_idx ON public.vendors(status);
CREATE INDEX vendors_email_idx ON public.vendors(email);

-- ─── 2. Vendor applications (per event) ───────────────────
-- One row per vendor per event they apply to. Chef approves/declines each.
CREATE TABLE public.vendor_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  vendor_note text,
  decision_note text,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  applied_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, event_id)
);

CREATE INDEX vendor_applications_vendor_idx ON public.vendor_applications(vendor_id);
CREATE INDEX vendor_applications_event_idx ON public.vendor_applications(event_id);
CREATE INDEX vendor_applications_status_idx ON public.vendor_applications(status);

-- ─── 3. Vendor attendance (check-ins) ─────────────────────
-- Created when a vendor checks in on event day. Geo coords + computed
-- distance to Trainer Center stored for verification.
CREATE TABLE public.vendor_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  lat double precision,
  lng double precision,
  distance_m double precision,
  geo_verified boolean NOT NULL DEFAULT false,
  UNIQUE (vendor_id, event_id)
);

CREATE INDEX vendor_attendance_vendor_idx ON public.vendor_attendance(vendor_id);
CREATE INDEX vendor_attendance_event_idx ON public.vendor_attendance(event_id);

-- ─── 4. Vendor submissions (post-event content) ───────────
-- One row per vendor per event for the post-event social-style write-up.
-- Media (photos/video) lives in vendor_media linked back here.
CREATE TABLE public.vendor_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  caption text,
  visible boolean NOT NULL DEFAULT true,
  featured boolean NOT NULL DEFAULT false,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, event_id)
);

CREATE INDEX vendor_submissions_vendor_idx ON public.vendor_submissions(vendor_id);
CREATE INDEX vendor_submissions_event_idx ON public.vendor_submissions(event_id);
CREATE INDEX vendor_submissions_visible_idx ON public.vendor_submissions(visible) WHERE visible = true;

-- ─── 5. Vendor media ──────────────────────────────────────
-- One row per photo or video attached to a submission.
-- Photos: supabase_path holds the storage object path (bucket: vendor-media).
-- Videos: bunny_video_id holds the Bunny Stream library video id;
--         bunny_playback_url holds the iframe embed URL.
CREATE TABLE public.vendor_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.vendor_submissions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('photo', 'video')),
  supabase_path text,
  bunny_video_id text,
  bunny_playback_url text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'photo' AND supabase_path IS NOT NULL)
    OR (kind = 'video' AND bunny_video_id IS NOT NULL)
  )
);

CREATE INDEX vendor_media_submission_idx ON public.vendor_media(submission_id);

-- ─── 6. Helper: is_vendor_owner ───────────────────────────
-- SECURITY DEFINER lookup so RLS policies can check "is this auth user the
-- owner of this vendor row?" without triggering recursive policy checks.
CREATE OR REPLACE FUNCTION public.is_vendor_owner(check_vendor_id uuid, check_uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vendors WHERE id = check_vendor_id AND user_id = check_uid
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_vendor_owner(uuid, uuid) TO authenticated, anon;

-- ─── 7. updated_at triggers ───────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER vendors_set_updated_at
  BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER vendor_submissions_set_updated_at
  BEFORE UPDATE ON public.vendor_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 8. RLS: vendors ──────────────────────────────────────
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

-- Anyone (incl. anon) can read approved vendor profiles for the public feed.
CREATE POLICY "Public can view approved vendors"
  ON public.vendors
  FOR SELECT
  TO anon, authenticated
  USING (status = 'approved');

-- A vendor can read + update their own row regardless of status.
CREATE POLICY "Vendors can view own row"
  ON public.vendors
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Vendors can update own row"
  ON public.vendors
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Anyone authenticated can insert a vendor row (first-time application).
-- The user_id is set to auth.uid() at insert time.
CREATE POLICY "Authenticated users can apply"
  ON public.vendors
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Admins can do everything.
CREATE POLICY "Admins can view all vendors"
  ON public.vendors
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update any vendor"
  ON public.vendors
  FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete vendors"
  ON public.vendors
  FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- ─── 9. RLS: vendor_applications ──────────────────────────
ALTER TABLE public.vendor_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendors can view own applications"
  ON public.vendor_applications
  FOR SELECT
  TO authenticated
  USING (public.is_vendor_owner(vendor_id, auth.uid()));

CREATE POLICY "Vendors can create own applications"
  ON public.vendor_applications
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_vendor_owner(vendor_id, auth.uid()));

CREATE POLICY "Vendors can cancel own applications"
  ON public.vendor_applications
  FOR UPDATE
  TO authenticated
  USING (public.is_vendor_owner(vendor_id, auth.uid()))
  WITH CHECK (public.is_vendor_owner(vendor_id, auth.uid()));

CREATE POLICY "Admins can manage all applications"
  ON public.vendor_applications
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- ─── 10. RLS: vendor_attendance ───────────────────────────
ALTER TABLE public.vendor_attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendors can view own attendance"
  ON public.vendor_attendance
  FOR SELECT
  TO authenticated
  USING (public.is_vendor_owner(vendor_id, auth.uid()));

CREATE POLICY "Vendors can check themselves in"
  ON public.vendor_attendance
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_vendor_owner(vendor_id, auth.uid()));

CREATE POLICY "Admins can manage all attendance"
  ON public.vendor_attendance
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- ─── 11. RLS: vendor_submissions ──────────────────────────
ALTER TABLE public.vendor_submissions ENABLE ROW LEVEL SECURITY;

-- Public can read visible submissions for the feed.
CREATE POLICY "Public can view visible submissions"
  ON public.vendor_submissions
  FOR SELECT
  TO anon, authenticated
  USING (visible = true);

CREATE POLICY "Vendors can view own submissions"
  ON public.vendor_submissions
  FOR SELECT
  TO authenticated
  USING (public.is_vendor_owner(vendor_id, auth.uid()));

CREATE POLICY "Vendors can create own submissions"
  ON public.vendor_submissions
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_vendor_owner(vendor_id, auth.uid()));

CREATE POLICY "Vendors can update own submissions"
  ON public.vendor_submissions
  FOR UPDATE
  TO authenticated
  USING (public.is_vendor_owner(vendor_id, auth.uid()))
  WITH CHECK (public.is_vendor_owner(vendor_id, auth.uid()));

CREATE POLICY "Admins can manage all submissions"
  ON public.vendor_submissions
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- ─── 12. RLS: vendor_media ────────────────────────────────
ALTER TABLE public.vendor_media ENABLE ROW LEVEL SECURITY;

-- Media inherits visibility from its parent submission.
CREATE POLICY "Public can view media of visible submissions"
  ON public.vendor_media
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vendor_submissions s
      WHERE s.id = submission_id AND s.visible = true
    )
  );

CREATE POLICY "Vendors can view own media"
  ON public.vendor_media
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vendor_submissions s
      WHERE s.id = submission_id
        AND public.is_vendor_owner(s.vendor_id, auth.uid())
    )
  );

CREATE POLICY "Vendors can add own media"
  ON public.vendor_media
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vendor_submissions s
      WHERE s.id = submission_id
        AND public.is_vendor_owner(s.vendor_id, auth.uid())
    )
  );

CREATE POLICY "Vendors can delete own media"
  ON public.vendor_media
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vendor_submissions s
      WHERE s.id = submission_id
        AND public.is_vendor_owner(s.vendor_id, auth.uid())
    )
  );

CREATE POLICY "Admins can manage all media"
  ON public.vendor_media
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
