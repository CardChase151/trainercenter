-- subscribe_to_reminders: single-call upsert that turns a freshly-signed-up
-- auth user into a TC member + a marketing_contacts row with the categories
-- they picked. Public-facing reminder signup (the wiggle banner on the
-- calendar and the /reminders page) calls this immediately after auth.signUp
-- so the subscription preferences land before the user navigates away.
--
-- The function is SECURITY DEFINER because anonymous users cannot write to
-- members or marketing_contacts directly. It pulls the email from auth.users
-- using auth.uid(), so the caller cannot subscribe a different email than
-- the one they just authenticated with.

CREATE OR REPLACE FUNCTION public.subscribe_to_reminders(p_subscriptions jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
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
    RAISE EXCEPTION 'No email on file for this account';
  END IF;

  -- 1. Member row keyed to the auth user. Email is required (NOT NULL) so we
  --    only insert if missing; the existing row is left alone if present.
  INSERT INTO public.members (user_id, email)
  VALUES (v_uid, v_email)
  ON CONFLICT (user_id) DO NOTHING;

  -- 2. Marketing contact: upsert by email. Reminder signup overwrites the
  --    subscriptions object so the user's most-recent picks win, flips
  --    is_subscribed back on, and sets from_site so we can attribute the
  --    signup to the website (vs Square).
  IF EXISTS (SELECT 1 FROM public.marketing_contacts WHERE email = v_email) THEN
    UPDATE public.marketing_contacts
       SET subscriptions = p_subscriptions,
           is_subscribed = true,
           unsubscribed_at = NULL,
           unsubscribe_reason = NULL,
           from_site = true,
           updated_at = now()
     WHERE email = v_email;
  ELSE
    INSERT INTO public.marketing_contacts (email, subscriptions, is_subscribed, source, from_site)
    VALUES (v_email, p_subscriptions, true, 'reminder_signup', true);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.subscribe_to_reminders(jsonb) TO authenticated;
