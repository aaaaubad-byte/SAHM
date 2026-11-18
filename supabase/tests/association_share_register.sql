-- Share-register RPC contract: authenticated manager-only read, no SECURITY DEFINER bypass.
DO $$
DECLARE
  v_oid oid := to_regprocedure('public.get_association_shares(uuid)');
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
END;
$$;

SELECT 'SAHM share register contract passed' AS result;
