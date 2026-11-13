-- SAHM email authentication and profile onboarding invariants.
DO $$
DECLARE v_tables integer; v_rls boolean; v_trigger boolean; v_fn text;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='avatar_key'
      AND data_type='text' AND is_nullable='NO'
  ) THEN RAISE EXCEPTION 'profiles.avatar_key is not configured'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='profile_completed'
      AND data_type='boolean' AND is_nullable='NO'
  ) THEN RAISE EXCEPTION 'profiles.profile_completed is not configured'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profile_private' AND column_name='phone_e164'
      AND is_nullable='YES'
  ) THEN RAISE EXCEPTION 'profile_private.phone_e164 must allow incomplete signup'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='legal_acceptances'
  ) THEN RAISE EXCEPTION 'legal_acceptances table is missing'; END IF;

  SELECT c.relrowsecurity INTO v_rls FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='legal_acceptances';
  IF NOT coalesce(v_rls,false) THEN RAISE EXCEPTION 'legal_acceptances must have RLS enabled'; END IF;

  IF NOT EXISTS(
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='auth' AND c.relname='users' AND NOT t.tgisinternal
      AND t.tgfoid='private.handle_new_user()'::regprocedure
  ) THEN RAISE EXCEPTION 'auth.users profile bootstrap trigger is missing'; END IF;

  IF has_function_privilege('anon','public.complete_my_profile(text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute complete_my_profile';
  END IF;
  IF NOT has_function_privilege('authenticated','public.complete_my_profile(text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must execute complete_my_profile';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid='public.complete_my_profile(text,text,text)'::regprocedure) THEN
    RAISE EXCEPTION 'public complete_my_profile wrapper must remain SECURITY INVOKER';
  END IF;

  SELECT pg_get_functiondef('private.complete_my_profile(text,text,text)'::regprocedure) INTO v_fn;
  IF position('legal_acceptances' in v_fn)=0 OR position('2026-11-14' in v_fn)=0 THEN
    RAISE EXCEPTION 'Completing the profile must require the accepted current terms version';
  END IF;
  IF position('array_length(v_parts,1)' in v_fn)=0 THEN
    RAISE EXCEPTION 'Profile completion must require a triple-part full name';
  END IF;

  SELECT pg_get_functiondef('private.update_my_profile(text,text)'::regprocedure) INTO v_fn;
  IF position('array_length(v_parts,1)' in v_fn)=0 THEN
    RAISE EXCEPTION 'Profile updates must preserve triple-part full name validation';
  END IF;

  SELECT pg_get_functiondef('private.accept_invitation(text)'::regprocedure) INTO v_fn;
  IF position('profile_completed' in v_fn)=0 OR position('invitee_phone_e164' in v_fn)=0 THEN
    RAISE EXCEPTION 'Invitation acceptance is missing profile completion or invited-phone verification';
  END IF;

  SELECT pg_get_functiondef('private.send_chat_message(uuid,text)'::regprocedure) INTO v_fn;
  IF position('is_association_manager' in v_fn)=0 THEN
    RAISE EXCEPTION 'Manager-only chat access path is missing';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='association_user_preferences' AND policyname='association_prefs_select'
      AND qual LIKE '%is_association_manager%'
  ) THEN RAISE EXCEPTION 'Manager self preference policy is missing'; END IF;
END;
$$;
SELECT 'SAHM email auth and profile invariants passed' AS result;
