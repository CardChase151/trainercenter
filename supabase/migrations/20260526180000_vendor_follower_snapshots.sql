-- Per-vendor follower-count snapshots.
-- Used on /staff/events/:id/timemap so staff can track each vendor's
-- Instagram audience growth across events ("show vs next vs next").
--
-- Optionally tied to an event_id so we can say "at Trade Night 5/29 they
-- had 1,250 followers" — but event_id is nullable so off-event snapshots
-- (e.g. quick check during week) still record cleanly. Display order is
-- by recorded_at DESC, regardless of event linkage.

CREATE TABLE public.vendor_follower_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  event_id uuid NULL REFERENCES public.events(id) ON DELETE SET NULL,
  ig_followers integer NOT NULL CHECK (ig_followers >= 0),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX vendor_follower_snapshots_vendor_idx
  ON public.vendor_follower_snapshots(vendor_id, recorded_at DESC);
CREATE INDEX vendor_follower_snapshots_event_idx
  ON public.vendor_follower_snapshots(event_id);

ALTER TABLE public.vendor_follower_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read all follower snapshots"
  ON public.vendor_follower_snapshots FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins create own snapshots"
  ON public.vendor_follower_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin(auth.uid())
    AND recorded_by = auth.uid()
  );

CREATE POLICY "Authors update own snapshots"
  ON public.vendor_follower_snapshots FOR UPDATE
  TO authenticated
  USING (
    public.is_admin(auth.uid())
    AND recorded_by = auth.uid()
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    AND recorded_by = auth.uid()
  );

CREATE POLICY "Authors delete own snapshots"
  ON public.vendor_follower_snapshots FOR DELETE
  TO authenticated
  USING (
    public.is_admin(auth.uid())
    AND recorded_by = auth.uid()
  );

COMMENT ON TABLE public.vendor_follower_snapshots IS
  'Time-series of vendor IG follower counts. Optional event_id ties a snapshot to a specific show. Sorted by recorded_at DESC for display.';
