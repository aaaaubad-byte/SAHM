CREATE OR REPLACE FUNCTION private.accept_legacy_invitation_by_id(p_invitation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
  v_uid uuid:=auth.uid(); v_inv public.invitations%ROWTYPE; v_assoc public.associations%ROWTYPE;
  v_membership uuid; v_share_no integer; v_i integer; v_cycle record; v_period record; v_event uuid;
  v_phone text; v_completed boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
  SELECT p.profile_completed,pp.phone_e164 INTO v_completed,v_phone
  FROM public.profiles p LEFT JOIN public.profile_private pp ON pp.user_id=p.id
  WHERE p.id=v_uid;
  IF NOT coalesce(v_completed,false) THEN RAISE EXCEPTION 'أكمل بيانات حسابك قبل قبول الدعوة' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_inv FROM public.invitations
  WHERE id=p_invitation_id AND status='pending' AND shares_requested IS NOT NULL
    AND response_status IN ('pending_response','interested','deferred')
    AND (expires_at IS NULL OR expires_at>now())
    AND (invited_user_id=v_uid OR (invitee_phone_e164 IS NOT NULL AND invitee_phone_e164=v_phone))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الدعوة القديمة غير موجودة أو غير موجهة إلى حسابك أو منتهية' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_assoc FROM public.associations WHERE id=v_inv.association_id FOR UPDATE;
  IF NOT FOUND OR v_assoc.status<>'active' OR v_assoc.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'أُغلقت العضويات بعد تثبيت أول قرعة' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM public.association_memberships WHERE association_id=v_assoc.id AND user_id=v_uid) THEN
    RAISE EXCEPTION 'هذا الحساب عضو بالفعل في الجمعية' USING ERRCODE='23505';
  END IF;
  IF v_assoc.max_shares_per_member IS NOT NULL AND v_inv.shares_requested>v_assoc.max_shares_per_member THEN
    RAISE EXCEPTION 'عدد الأسهم يتجاوز الحد المسموح للفرد' USING ERRCODE='23514';
  END IF;
  IF v_assoc.target_shares IS NOT NULL THEN
    SELECT count(*) INTO v_share_no FROM public.shares WHERE association_id=v_assoc.id AND status='active';
    IF v_share_no+v_inv.shares_requested>v_assoc.target_shares THEN
      RAISE EXCEPTION 'لم تعد هناك أسهم متاحة بهذا العدد' USING ERRCODE='23514';
    END IF;
  END IF;

  INSERT INTO public.association_memberships(association_id,user_id)
  VALUES(v_assoc.id,v_uid) RETURNING id INTO v_membership;
  SELECT coalesce(max(share_no),0) INTO v_share_no FROM public.shares WHERE association_id=v_assoc.id;
  FOR v_i IN 1..v_inv.shares_requested LOOP
    INSERT INTO public.shares(association_id,membership_id,share_no)
    VALUES(v_assoc.id,v_membership,v_share_no+v_i);
  END LOOP;

  FOR v_cycle IN SELECT * FROM public.association_cycles WHERE association_id=v_assoc.id ORDER BY cycle_no LOOP
    FOR v_period IN SELECT * FROM public.installment_periods WHERE cycle_id=v_cycle.id ORDER BY installment_no LOOP
      INSERT INTO public.installment_obligations(
        association_id,cycle_id,membership_id,period_id,shares_count,amount_minor,currency
      ) VALUES (
        v_assoc.id,v_cycle.id,v_membership,v_period.id,v_inv.shares_requested,
        (v_period.per_share_amount_minor::numeric*v_inv.shares_requested::numeric)::bigint,v_cycle.currency
      ) ON CONFLICT(membership_id,period_id) DO NOTHING;
    END LOOP;
  END LOOP;

  UPDATE public.invitations SET status='accepted',response_status='legacy_accepted',
    invited_user_id=v_uid,accepted_at=now(),responded_at=coalesce(responded_at,now())
  WHERE id=v_inv.id;

  INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data)
  VALUES(v_assoc.id,v_uid,'member_joined','membership',v_membership,'all',
    jsonb_build_object('shares',v_inv.shares_requested,'legacy_invitation',true))
  RETURNING id INTO v_event;

  IF EXISTS(SELECT 1 FROM public.association_notification_settings s
    WHERE s.association_id=v_assoc.id AND 'joined'=ANY(s.enabled_types)) THEN
    INSERT INTO public.chat_messages(association_id,kind,body,system_type,event_id)
    VALUES(v_assoc.id,'system','انضم عضو جديد إلى الجمعية','joined',v_event);
  END IF;

  RETURN jsonb_build_object('membership_id',v_membership,'association_id',v_assoc.id,
    'shares_added',v_inv.shares_requested,'legacy_invitation',true);
END;
$function$;
REVOKE ALL ON FUNCTION private.accept_legacy_invitation_by_id(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.accept_legacy_invitation_by_id(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.accept_legacy_invitation_by_id(p_invitation_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$ SELECT private.accept_legacy_invitation_by_id(p_invitation_id); $function$;
REVOKE ALL ON FUNCTION public.accept_legacy_invitation_by_id(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accept_legacy_invitation_by_id(uuid) TO authenticated;
