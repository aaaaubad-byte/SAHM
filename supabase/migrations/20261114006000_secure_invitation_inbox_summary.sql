CREATE OR REPLACE FUNCTION private.get_my_invitation_inbox()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_phone text; v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
  SELECT phone_e164 INTO v_phone FROM public.profile_private WHERE user_id=v_uid;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'invitationId',i.id,'associationId',a.id,'groupId',a.id,
    'groupName',a.name,'managerName',p.full_name,'currency',a.currency,
    'startDate',a.start_date,'firstDrawOn',a.first_draw_on,'cycleDays',a.cycle_days,
    'shareAmountMinor',a.share_amount_minor,'installmentMode',a.installment_mode,
    'installmentAmountMinor',a.installment_amount_minor,'installments',a.installments_count,
    'responseStatus',i.response_status,'legacy',(i.shares_requested IS NOT NULL),
    'sharesRequested',i.shares_requested,'inviteeName',i.invitee_name,
    'createdAt',i.created_at,'expiresAt',i.expires_at,
    'isJoinOpen',(
      a.status='active' AND a.locked_at IS NULL
      AND (now() AT TIME ZONE a.time_zone)::date<a.start_date
      AND (a.invite_opens_on IS NULL OR (now() AT TIME ZONE a.time_zone)::date>=a.invite_opens_on)
      AND (a.invite_closes_on IS NULL OR (now() AT TIME ZONE a.time_zone)::date<=a.invite_closes_on)
    )
  ) ORDER BY i.created_at DESC),'[]'::jsonb)
  INTO v_result
  FROM public.invitations i
  JOIN public.associations a ON a.id=i.association_id
  JOIN public.profiles p ON p.id=a.manager_user_id
  WHERE i.status='pending'
    AND i.response_status IN ('pending_response','interested','deferred')
    AND (i.expires_at IS NULL OR i.expires_at>now())
    AND (i.invited_user_id=v_uid OR (i.invitee_phone_e164 IS NOT NULL AND i.invitee_phone_e164=v_phone));
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION private.get_my_invitation_inbox() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.get_my_invitation_inbox() TO authenticated;
CREATE OR REPLACE FUNCTION public.get_my_invitation_inbox()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$ SELECT private.get_my_invitation_inbox(); $function$;
REVOKE ALL ON FUNCTION public.get_my_invitation_inbox() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_invitation_inbox() TO authenticated;
