-- SAHM schema invariant checks; run in Supabase SQL Editor with a privileged role.
DO $$
DECLARE
  v_tables integer;
  v_rls integer;
  v_anon_grants integer;
  v_phone text;
BEGIN
  SELECT count(*) INTO v_tables
  FROM pg_tables WHERE schemaname='public';
  IF v_tables<>24 THEN RAISE EXCEPTION 'Expected 23 public tables, got %',v_tables; END IF;

  SELECT count(*) INTO v_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity;
  IF v_rls<>24 THEN RAISE EXCEPTION 'RLS is not enabled on every public table: %/23',v_rls; END IF;

  SELECT count(*) INTO v_anon_grants
  FROM information_schema.role_table_grants
  WHERE table_schema='public' AND grantee='anon';
  IF v_anon_grants<>0 THEN RAISE EXCEPTION 'anon has % table privileges',v_anon_grants; END IF;

  IF has_function_privilege('anon','public.rls_auto_enable()','EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute rls_auto_enable';
  END IF;
  IF has_function_privilege('authenticated','public.rls_auto_enable()','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must not execute rls_auto_enable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public'
      AND indexname='installment_receipts_one_active_per_obligation'
  ) THEN RAISE EXCEPTION 'Missing unique active receipt index'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public'
      AND indexname='draws_share_wins_once'
  ) THEN RAISE EXCEPTION 'Missing unique winner-share index'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime'
      AND schemaname='public' AND tablename='chat_messages'
  ) THEN RAISE EXCEPTION 'chat_messages is not in supabase_realtime'; END IF;

  v_phone:=private.normalize_phone_e164('+٩٦٧ ٧٧٧-١٢٣-٤٥٦');
  IF v_phone<>'+967777123456' THEN RAISE EXCEPTION 'Arabic digit normalization failed: %',v_phone; END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
      AND p.proname IN ('create_association','create_invitation','accept_invitation',
        'record_installment_receipt','correct_installment_receipt','perform_draw',
        'send_chat_message','set_cycle_attendance','set_association_notification_types',
        'set_association_user_preferences','send_installment_reminders','mark_my_notification_read')
  ) THEN RAISE EXCEPTION 'An exposed RPC wrapper is SECURITY DEFINER'; END IF;
END;
$$;

SELECT 'SAHM schema invariants passed' AS result;
