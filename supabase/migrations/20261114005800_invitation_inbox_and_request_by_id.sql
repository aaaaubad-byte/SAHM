CREATE OR REPLACE FUNCTION private.get_my_invitation_details(p_invitation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_phone text; v_completed boolean; v_result jsonb; v_association_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
  SELECT p.profile_completed,pp.phone_e164 INTO v_completed,v_phone
  FROM public.profiles p LEFT JOIN public.profile_private pp ON pp.user_id=p.id WHERE p.id=v_uid;
  IF NOT coalesce(v_completed,false) THEN RAISE EXCEPTION 'أكمل بيانات حسابك قبل فتح الدعوة' USING ERRCODE='42501'; END IF;
  SELECT i.association_id INTO v_association_id FROM public.invitations i
  WHERE i.id=p_invitation_id AND i.status='pending'
    AND i.response_status IN ('pending_response','interested','deferred')
    AND (i.expires_at IS NULL OR i.expires_at>now())
    AND (i.invited_user_id=v_uid OR (i.invitee_phone_e164 IS NOT NULL AND i.invitee_phone_e164=v_phone));
  IF v_association_id IS NULL THEN RAISE EXCEPTION 'الدعوة غير موجودة أو غير موجهة إلى حسابك أو منتهية' USING ERRCODE='42501'; END IF;
  PERFORM private.assert_association_join_open(v_association_id);
  SELECT jsonb_build_object(
    'ok',true,'invitationId',i.id,'name',a.name,'managerName',p.full_name,'currency',a.currency,
    'startDate',a.start_date,'firstDrawOn',a.first_draw_on,'cycleDays',a.cycle_days,
    'installmentMode',a.installment_mode,'installmentAmountMinor',a.installment_amount_minor,
    'installments',a.installments_count,'shareAmountMinor',a.share_amount_minor,
    'responseStatus',i.response_status,'sharesRequested',i.shares_requested,
    'isLegacyInvitation',(i.shares_requested IS NOT NULL),'expiresAt',i.expires_at
  ) INTO v_result
  FROM public.invitations i JOIN public.associations a ON a.id=i.association_id
  JOIN public.profiles p ON p.id=a.manager_user_id WHERE i.id=p_invitation_id;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION private.get_my_invitation_details(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.get_my_invitation_details(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.get_my_invitation_details(p_invitation_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$ SELECT private.get_my_invitation_details(p_invitation_id); $function$;
REVOKE ALL ON FUNCTION public.get_my_invitation_details(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_invitation_details(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.submit_join_request_by_invitation(p_invitation_id uuid,p_requested_shares integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_a public.associations%ROWTYPE; v_inv public.invitations%ROWTYPE;
  v_phone text; v_completed boolean; v_estimate numeric; v_request_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
  IF p_requested_shares IS NULL OR p_requested_shares<1 THEN RAISE EXCEPTION 'عدد الأسهم المطلوب غير صالح' USING ERRCODE='22023'; END IF;
  SELECT p.profile_completed,pp.phone_e164 INTO v_completed,v_phone FROM public.profiles p
  LEFT JOIN public.profile_private pp ON pp.user_id=p.id WHERE p.id=v_uid;
  IF NOT coalesce(v_completed,false) THEN RAISE EXCEPTION 'أكمل بيانات حسابك قبل تقديم طلب الانضمام' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_inv FROM public.invitations WHERE id=p_invitation_id AND status='pending'
    AND response_status='interested' AND (expires_at IS NULL OR expires_at>now())
    AND invited_user_id=v_uid AND (invitee_phone_e164 IS NULL OR invitee_phone_e164=v_phone) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الدعوة غير صالحة أو لم توافق على استكمال الانضمام' USING ERRCODE='22023'; END IF;
  v_a:=private.assert_association_join_open(v_inv.association_id);
  PERFORM 1 FROM public.associations WHERE id=v_a.id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.association_memberships WHERE association_id=v_a.id AND user_id=v_uid) THEN
    RAISE EXCEPTION 'لديك سجل عضوية سابق في هذه الجمعية' USING ERRCODE='23505';
  END IF;
  v_estimate:=v_a.share_amount_minor::numeric*p_requested_shares::numeric;
  IF v_estimate<1 OR v_estimate>9223372036854775807 THEN RAISE EXCEPTION 'قيمة الالتزام تتجاوز النطاق المسموح' USING ERRCODE='22003'; END IF;
  INSERT INTO public.join_requests(association_id,applicant_user_id,invitation_id,public_link_id,source_type,requested_shares,estimated_amount_minor,status)
  VALUES(v_a.id,v_uid,v_inv.id,NULL,'invitation',p_requested_shares,v_estimate::bigint,'pending')
  RETURNING id INTO v_request_id;
  INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data)
  VALUES(v_a.id,v_uid,'join_request_submitted','join_request',v_request_id,'manager',
    jsonb_build_object('requested_shares',p_requested_shares,'estimated_amount_minor',v_estimate::bigint,'source_type','invitation'));
  RETURN jsonb_build_object('request_id',v_request_id,'association_id',v_a.id,'status','pending',
    'requested_shares',p_requested_shares,'estimated_amount_minor',v_estimate::bigint,'currency',v_a.currency,
    'installments_count',v_a.installments_count);
END;
$function$;
REVOKE ALL ON FUNCTION private.submit_join_request_by_invitation(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.submit_join_request_by_invitation(uuid,integer) TO authenticated;
CREATE OR REPLACE FUNCTION public.submit_join_request_by_invitation(p_invitation_id uuid,p_requested_shares integer)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$ SELECT private.submit_join_request_by_invitation(p_invitation_id,p_requested_shares); $function$;
REVOKE ALL ON FUNCTION public.submit_join_request_by_invitation(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_join_request_by_invitation(uuid,integer) TO authenticated;
