-- Restore INVOKER security for every public RPC wrapper.
CREATE OR REPLACE FUNCTION public.update_association(p_association_id uuid,p_payload jsonb)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path TO ''
AS $function$ SELECT private.update_association(p_association_id,p_payload); $function$;
CREATE OR REPLACE FUNCTION public.add_shares(p_membership_id uuid,p_count integer)
RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path TO ''
AS $function$ SELECT private.add_shares(p_membership_id,p_count); $function$;
CREATE OR REPLACE FUNCTION public.remove_shares(p_membership_id uuid,p_count integer)
RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path TO ''
AS $function$ SELECT private.remove_shares(p_membership_id,p_count); $function$;
CREATE OR REPLACE FUNCTION public.remove_member(p_membership_id uuid)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path TO ''
AS $function$ SELECT private.remove_member(p_membership_id); $function$;
CREATE OR REPLACE FUNCTION public.cancel_invitation(p_invitation_id uuid)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path TO ''
AS $function$ SELECT private.cancel_invitation(p_invitation_id); $function$;
CREATE OR REPLACE FUNCTION public.preview_invitation(p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO ''
AS $function$ SELECT private.preview_invitation(p_token); $function$;
CREATE OR REPLACE FUNCTION public.update_my_profile(p_full_name text,p_city text)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path TO ''
AS $function$ SELECT private.update_my_profile(p_full_name,p_city); $function$;

GRANT EXECUTE ON FUNCTION private.update_association(uuid,jsonb),private.add_shares(uuid,integer),
 private.remove_shares(uuid,integer),private.remove_member(uuid),private.cancel_invitation(uuid),
 private.preview_invitation(text),private.update_my_profile(text,text) TO authenticated;
REVOKE ALL ON FUNCTION private.rebuild_open_association_obligations(uuid),
 private.assert_association_pre_financial(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_association(uuid,jsonb),public.add_shares(uuid,integer),
 public.remove_shares(uuid,integer),public.remove_member(uuid),public.cancel_invitation(uuid),
 public.preview_invitation(text),public.update_my_profile(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_association(uuid,jsonb),public.add_shares(uuid,integer),
 public.remove_shares(uuid,integer),public.remove_member(uuid),public.cancel_invitation(uuid),
 public.preview_invitation(text),public.update_my_profile(text,text) TO authenticated;
