-- SAHM migration: append-only financial and audit history
-- Applied to Supabase project nusjnnrtpxbpphphmdsc on 2026-11-13.
-- The live schema was bootstrapped from the initial schema definition before this
-- migration was registered. This migration is replayable after that baseline.

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

CREATE TRIGGER association_events_append_only
BEFORE UPDATE OR DELETE ON public.association_events
FOR EACH ROW EXECUTE FUNCTION private.guard_append_only_history();
CREATE TRIGGER receipt_corrections_append_only
BEFORE UPDATE OR DELETE ON public.receipt_corrections
FOR EACH ROW EXECUTE FUNCTION private.guard_append_only_history();
CREATE TRIGGER installment_receipts_history_guard
BEFORE UPDATE OR DELETE ON public.installment_receipts
FOR EACH ROW EXECUTE FUNCTION private.guard_append_only_history();
CREATE TRIGGER draws_append_only
BEFORE UPDATE OR DELETE ON public.draws
FOR EACH ROW EXECUTE FUNCTION private.guard_append_only_history();
CREATE TRIGGER draw_eligible_shares_append_only
BEFORE UPDATE OR DELETE ON public.draw_eligible_shares
FOR EACH ROW EXECUTE FUNCTION private.guard_append_only_history();
CREATE TRIGGER chat_messages_append_only
BEFORE UPDATE OR DELETE ON public.chat_messages
FOR EACH ROW EXECUTE FUNCTION private.guard_append_only_history();
CREATE TRIGGER reminders_append_only
BEFORE UPDATE OR DELETE ON public.reminders
FOR EACH ROW EXECUTE FUNCTION private.guard_append_only_history();
