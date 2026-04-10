-- Tighten events RLS: previous policies were named "Staff can..." but had
-- check expressions of literal `true`, allowing any authenticated user to write.
-- Replaced with policies gated on JWT user_metadata.is_admin.
-- (Superseded by 20260410170000_fix_profiles_rls_recursion.sql which moves the
-- check to a SECURITY DEFINER function reading public.profiles instead.)

DROP POLICY IF EXISTS "Staff can create events" ON public.events;
DROP POLICY IF EXISTS "Staff can update events" ON public.events;
DROP POLICY IF EXISTS "Staff can delete events" ON public.events;

CREATE POLICY "Admins can create events"
  ON public.events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    COALESCE((auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean, false) = true
  );

CREATE POLICY "Admins can update events"
  ON public.events
  FOR UPDATE
  TO authenticated
  USING (
    COALESCE((auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean, false) = true
  )
  WITH CHECK (
    COALESCE((auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean, false) = true
  );

CREATE POLICY "Admins can delete events"
  ON public.events
  FOR DELETE
  TO authenticated
  USING (
    COALESCE((auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean, false) = true
  );
