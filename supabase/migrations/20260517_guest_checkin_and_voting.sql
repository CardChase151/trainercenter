-- Trade Night guest experience: door-QR check-in + 3-vote favorite-vendor system.
--
-- Two tables:
--   guest_checkins  — one row per (event, profile). Records who walked in,
--                     when, and which vendor invited them (if any).
--   vendor_votes    — up to 3 rows per (event, profile). Each row = one
--                     point awarded toward Favorite Vendor of the Night.
--
-- Both tables have a `preview` flag so staff can sample the flow without
-- polluting real metrics. Analytics views should filter `preview = false`.

-- ── guest_checkins ────────────────────────────────────────────────────────
CREATE TABLE public.guest_checkins (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  profile_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invited_by_vendor_id  uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  checked_in_at         timestamptz NOT NULL DEFAULT now(),
  preview               boolean NOT NULL DEFAULT false,
  UNIQUE (event_id, profile_id)
);

CREATE INDEX guest_checkins_event_idx       ON public.guest_checkins(event_id);
CREATE INDEX guest_checkins_invited_by_idx  ON public.guest_checkins(invited_by_vendor_id);
CREATE INDEX guest_checkins_profile_idx     ON public.guest_checkins(profile_id);

ALTER TABLE public.guest_checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Guests can view their own check-ins"
  ON public.guest_checkins
  FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

CREATE POLICY "Guests can create their own check-in"
  ON public.guest_checkins
  FOR INSERT
  TO authenticated
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "Guests can update their own check-in"
  ON public.guest_checkins
  FOR UPDATE
  TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "Admins can view all check-ins"
  ON public.guest_checkins
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- ── vendor_votes ──────────────────────────────────────────────────────────
CREATE TABLE public.vendor_votes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  vendor_id   uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  preview     boolean NOT NULL DEFAULT false,
  UNIQUE (event_id, profile_id, vendor_id)
);

CREATE INDEX vendor_votes_event_idx     ON public.vendor_votes(event_id);
CREATE INDEX vendor_votes_vendor_idx    ON public.vendor_votes(vendor_id);
CREATE INDEX vendor_votes_profile_idx   ON public.vendor_votes(profile_id);

-- Enforce: max 3 votes per (event, profile). Trigger fires BEFORE INSERT.
CREATE OR REPLACE FUNCTION public.enforce_max_3_vendor_votes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    SELECT COUNT(*) FROM public.vendor_votes
    WHERE event_id = NEW.event_id AND profile_id = NEW.profile_id
  ) >= 3 THEN
    RAISE EXCEPTION 'Max 3 vendor votes per event (profile already has 3)';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER vendor_votes_max_3
  BEFORE INSERT ON public.vendor_votes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_max_3_vendor_votes();

ALTER TABLE public.vendor_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Guests can view their own votes"
  ON public.vendor_votes
  FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

CREATE POLICY "Guests can cast their own votes"
  ON public.vendor_votes
  FOR INSERT
  TO authenticated
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "Guests can remove their own votes"
  ON public.vendor_votes
  FOR DELETE
  TO authenticated
  USING (profile_id = auth.uid());

CREATE POLICY "Admins can view all votes"
  ON public.vendor_votes
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- ── Convenience views for analytics (real metrics only — preview filtered) ──

-- Per-event guest-invited leaderboard: vendor with most invites wins
CREATE OR REPLACE VIEW public.event_invite_leaderboard AS
SELECT
  gc.event_id,
  gc.invited_by_vendor_id AS vendor_id,
  v.name,
  v.ig_handle,
  COUNT(*) AS invite_count
FROM public.guest_checkins gc
JOIN public.vendors v ON v.id = gc.invited_by_vendor_id
WHERE gc.preview = false
  AND gc.invited_by_vendor_id IS NOT NULL
GROUP BY gc.event_id, gc.invited_by_vendor_id, v.name, v.ig_handle
ORDER BY invite_count DESC;

-- Per-event favorite-vendor leaderboard: most votes wins
CREATE OR REPLACE VIEW public.event_favorite_leaderboard AS
SELECT
  vv.event_id,
  vv.vendor_id,
  v.name,
  v.ig_handle,
  COUNT(*) AS vote_count
FROM public.vendor_votes vv
JOIN public.vendors v ON v.id = vv.vendor_id
WHERE vv.preview = false
GROUP BY vv.event_id, vv.vendor_id, v.name, v.ig_handle
ORDER BY vote_count DESC;
