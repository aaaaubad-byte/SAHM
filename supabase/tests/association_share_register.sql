-- Share-register RPC contract: authenticated manager-only read, no SECURITY DEFINER bypass.
DO $$
DECLARE
  v_oid oid := to_regprocedure('public.get_association_shares(uuid)');
  v_my_oid oid := to_regprocedure('public.get_my_association_shares(uuid)');
  v_my_def text;
BEGIN
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Missing public.get_association_shares(uuid)'; END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid=v_oid) THEN
    RAISE EXCEPTION 'Share-register RPC must remain SECURITY INVOKER';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute share-register RPC';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must execute share-register RPC';
  END IF;

  IF v_my_oid IS NULL THEN RAISE EXCEPTION 'Missing public.get_my_association_shares(uuid)'; END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid=v_my_oid) THEN
    RAISE EXCEPTION 'Participant share RPC must remain SECURITY INVOKER';
  END IF;
  IF has_function_privilege('anon', v_my_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute participant share RPC';
  END IF;
  IF NOT has_function_privilege('authenticated', v_my_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must execute participant share RPC';
  END IF;
  v_my_def := pg_get_functiondef(v_my_oid);
  IF position('m.user_id = v_uid' in v_my_def) = 0 OR
     position('s.membership_id = v_membership_id' in v_my_def) = 0 THEN
    RAISE EXCEPTION 'Participant share RPC must filter by auth.uid() membership';
  END IF;
END;
$;

SELECT 'SAHM manager and participant share-read contracts passed' AS result;
