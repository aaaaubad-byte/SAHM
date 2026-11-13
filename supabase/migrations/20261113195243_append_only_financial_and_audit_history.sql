-- SAHM migration: append-only financial and audit history.
-- This migration can run before the baseline schema: trigger attachment is deferred
-- until the corresponding tables exist; the baseline migration attaches them later.

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.guard_append_only_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $fn$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'السجل التاريخي لا يحذف؛ استخدم إجراء تصحيح موثق' USING ERRCODE='55000';
  END IF;
  IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='installment_receipts' AND TG_OP='UPDATE' THEN
    IF OLD.status='active' AND NEW.status='voided'
       AND (to_jsonb(NEW)-'status')=(to_jsonb(OLD)-'status') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'لا يسمح بتعديل سجل الاستلام؛ استخدم إجراء التصحيح' USING ERRCODE='55000';
  END IF;
  RAISE EXCEPTION 'هذا السجل append-only ولا يسمح بتعديله' USING ERRCODE='55000';
END;
$fn$;

REVOKE ALL ON FUNCTION private.guard_append_only_history() FROM PUBLIC,anon,authenticated;

DO $attach$
BEGIN
  IF to_regclass('public.association_events') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='association_events_append_only') THEN
    CREATE TRIGGER association_events_append_only BEFORE UPDATE OR DELETE ON public.association_events FOR EACH ROW EXECUTE FUNCTION private.guard_append_only_history();
  END IF;
  IF to_regclass('public.receipt_corrections') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='receipt_corrections_append_only') THEN
    CREATE TRIGGER receipt_corrections_append_only BEFORE UPDATE OR DELETE ON public.receipt_corrections FOR EACH ROW EXECUTE FUNCTION private.guard_append_only_history();
  END IF;
  IF to_regclass('public.installment_receipts') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='installment_receipts_history_guard') THEN
    CREATE TRIGGER installment_receipts_history_guard BEFORE UPDATE OR DELETE ON public.installment_receipts FOR EACH ROW EXECUTE FUNCTION private.guard_append_only_history();
  END IF;
  IF to_regclass('public.draws') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='draws_append_only') THEN
    CREATE TRIGGER draws_append_only BEFORE UPDATE OR DELETE ON public.draws FOR EACH ROW EXECUTE FUNCTION private.guard_append_only_history();
  END IF;
  IF to_regclass('public.draw_eligible_shares') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='draw_eligible_shares_append_only') THEN
    CREATE TRIGGER draw_eligible_shares_append_only BEFORE UPDATE OR DELETE ON public.draw_eligible_shares FOR EACH ROW EXECUTE FUNCTION private.guard_append_only_history();
  END IF;
  IF to_regclass('public.chat_messages') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='chat_messages_append_only') THEN
    CREATE TRIGGER chat_messages_append_only BEFORE UPDATE OR DELETE ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION private.guard_append_only_history();
  END IF;
  IF to_regclass('public.reminders') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='reminders_append_only') THEN
    CREATE TRIGGER reminders_append_only BEFORE UPDATE OR DELETE ON public.reminders FOR EACH ROW EXECUTE FUNCTION private.guard_append_only_history();
  END IF;
END;
$attach$;
