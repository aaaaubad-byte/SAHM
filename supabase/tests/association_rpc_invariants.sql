
-- SAHM association RPC security and existence checks.
DO $$
DECLARE v_missing text[];
BEGIN
  SELECT array_agg(required.name) INTO v_missing
  FROM (VALUES
    ('update_association'),('add_shares'),('remove_shares'),('remove_member'),
    ('cancel_invitation'),('preview_invitation'),('update_my_profile')
  ) AS required(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=required.name
  );
  IF coalesce(array_length(v_missing,1),0)>0 THEN
    RAISE EXCEPTION 'Missing public RPCs: %',array_to_string(v_missing,', ');
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('update_association','add_shares','remove_shares','remove_member',
        'cancel_invitation','preview_invitation','update_my_profile')
      AND p.prosecdef
  ) THEN RAISE EXCEPTION 'New public RPC wrappers must remain SECURITY INVOKER'; END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='private'
      AND p.proname IN ('update_association','add_shares','remove_shares','remove_member',
        'cancel_invitation','preview_invitation','update_my_profile')
      AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
  ) THEN RAISE EXCEPTION 'Authenticated role is missing private RPC execution grants'; END IF;

  IF has_function_privilege('anon','public.preview_invitation(text)','EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous role must not preview invitation tokens';
  END IF;
END;
$$;
SELECT 'SAHM association RPC invariants passed' AS result;
