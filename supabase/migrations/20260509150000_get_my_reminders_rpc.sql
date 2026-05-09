-- get_my_reminders: lets the authenticated user read their own reminder
-- preferences without opening up direct SELECT on marketing_contacts.
-- Returns null/empty when the user has no contact row yet (so the UI can
-- distinguish "never signed up" from "subscribed to nothing").

CREATE OR REPLACE FUNCTION public.get_my_reminders()
RETURNS TABLE (subscriptions jsonb, is_subscribed boolean, has_record boolean)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT lower(email) INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL OR length(v_email) = 0 THEN
    RETURN QUERY SELECT NULL::jsonb, false, false;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT mc.subscriptions, mc.is_subscribed, true
  FROM public.marketing_contacts mc
  WHERE mc.email = v_email
  LIMIT 1;

  -- If the SELECT returned no rows, surface a default tuple so the caller
  -- always gets a single row back.
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::jsonb, false, false;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_reminders() TO authenticated;
