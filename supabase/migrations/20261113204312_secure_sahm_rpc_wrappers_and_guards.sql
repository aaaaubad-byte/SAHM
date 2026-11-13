-- SECURITY DEFINER wrappers used during the intermediate migration step.
-- The following align_sahm_rpc_invoker_security migration restores SECURITY INVOKER wrappers.
CREATE OR REPLACE FUNCTION public.update_association(p_association_id uuid,p_payload jsonb)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $function$ SELECT private.update_association(p_association_id,p_payload); $function$;
CREATE OR REPLACE FUNCTION public.add_shares(p_membership_id uuid,p_count integer)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $function$ SELECT private.add_shares(p_membership_id,p_count); $function$;
CREATE OR REPLACE FUNCTION public.remove_shares(p_membership_id uuid,p_count integer)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $function$ SELECT private.remove_shares(p_membership_id,p_count); $function$;
CREATE OR REPLACE FUNCTION public.remove_member(p_membership_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $function$ SELECT private.remove_member(p_membership_id); $function$;
CREATE OR REPLACE FUNCTION public.cancel_invitation(p_invitation_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $function$ SELECT private.cancel_invitation(p_invitation_id); $function$;
CREATE OR REPLACE FUNCTION public.preview_invitation(p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$ SELECT private.preview_invitation(p_token); $function$;
CREATE OR REPLACE FUNCTION public.update_my_profile(p_full_name text,p_city text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $function$ SELECT private.update_my_profile(p_full_name,p_city); $function$;

CREATE OR REPLACE FUNCTION private.assert_association_pre_financial(p_association_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
 IF EXISTS(SELECT 1 FROM public.installment_receipts WHERE association_id=p_association_id)
    OR EXISTS(
      SELECT 1 FROM public.reminders r
      JOIN public.installment_obligations o ON o.id=r.obligation_id
      WHERE o.association_id=p_association_id
    )
    OR EXISTS(SELECT 1 FROM public.draws WHERE association_id=p_association_id) THEN
   RAISE EXCEPTION 'لا يمكن تغيير العضويات أو الإعدادات بعد بدء سجل الأقساط أو التذكيرات أو القرعات' USING ERRCODE='23514';
 END IF;
END;
$function$;

REVOKE ALL ON FUNCTION private.assert_association_pre_financial(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_association(uuid,jsonb),public.add_shares(uuid,integer),
 public.remove_shares(uuid,integer),public.remove_member(uuid),public.cancel_invitation(uuid),
 public.preview_invitation(text),public.update_my_profile(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_association(uuid,jsonb),public.add_shares(uuid,integer),
 public.remove_shares(uuid,integer),public.remove_member(uuid),public.cancel_invitation(uuid),
 public.preview_invitation(text),public.update_my_profile(text,text) TO authenticated;
