-- Per-vendor staff notes.
--
-- Any admin can read every note (so the full institutional memory is
-- visible). Only the author can edit or delete their own — other staff
-- can't rewrite history.
--
-- One row per note (not one row per vendor). The UI shows them in a
-- chronological feed on the vendor card.

CREATE TABLE public.vendor_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(trim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX vendor_notes_vendor_idx ON public.vendor_notes(vendor_id, created_at DESC);
CREATE INDEX vendor_notes_author_idx ON public.vendor_notes(author_user_id);

ALTER TABLE public.vendor_notes ENABLE ROW LEVEL SECURITY;

-- Any admin can see every note (cross-staff visibility is the whole point).
CREATE POLICY "Admins read all vendor notes"
  ON public.vendor_notes FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- Admins can create notes as themselves (no impersonating another author).
CREATE POLICY "Admins create own notes"
  ON public.vendor_notes FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin(auth.uid())
    AND author_user_id = auth.uid()
  );

-- Only the author can edit their own — admin status alone is NOT enough.
CREATE POLICY "Authors update own notes"
  ON public.vendor_notes FOR UPDATE
  TO authenticated
  USING (
    public.is_admin(auth.uid())
    AND author_user_id = auth.uid()
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    AND author_user_id = auth.uid()
  );

-- Only the author can delete their own.
CREATE POLICY "Authors delete own notes"
  ON public.vendor_notes FOR DELETE
  TO authenticated
  USING (
    public.is_admin(auth.uid())
    AND author_user_id = auth.uid()
  );

-- Auto-bump updated_at on any UPDATE so the UI can show "edited" markers.
CREATE OR REPLACE FUNCTION public.vendor_notes_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER vendor_notes_touch_updated_at
  BEFORE UPDATE ON public.vendor_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.vendor_notes_touch_updated_at();
