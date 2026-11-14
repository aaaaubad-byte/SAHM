-- SAHM unified association workflow RPCs.
-- New operations are additive; the legacy invitation acceptance path remains for old invitations only.

CREATE OR REPLACE FUNCTION private.assert_association_join_open(p_association_id uuid)
RETURNS public.associations LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_a public.associations%ROWTYPE; v_local_date date;
BEGIN
  SELECT * INTO v_a FROM public.associations WHERE id=p_association_id;
  IF NOT FOUND OR v_a.status<>'active' OR v_a.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'الجمعية لا تستقبل طلبات انضمام جديدة' USING ERRCODE='23514';
  END IF;
  v_local_date := (now() AT TIME ZONE v_a.time_zone)::date;
  IF v_a.invite_opens_on IS NOT NULL AND v_local_date<v_a.invite_opens_on THEN
    RAISE EXCEPTION 'لم يبدأ موعد استقبال طلبات الانضمام' USING ERRCODE='23514';
  END IF;
  IF v_local_date>=v_a.start_date THEN
    RAISE EXCEPTION 'أُغلق الانضمام عند بداية الجمعية' USING ERRCODE='23514';
  END IF;
  IF v_a.invite_closes_on IS NOT NULL AND v_local_date>v_a.invite_closes_on THEN
    RAISE EXCEPTION 'انتهت فترة استقبال طلبات الانضمام' USING ERRCODE='23514';
  END IF;
  RETURN v_a;
END;
$function$;
REVOKE ALL ON FUNCTION private.assert_association_join_open(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.assert_association_join_open(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.create_association_unified(p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_uid uuid:=auth.uid(); v_name text; v_currency text; v_start date; v_first_draw date;
  v_days integer; v_tz text; v_amount bigint; v_mode text; v_installments integer;
  v_installment_amount bigint; v_manager_participates boolean; v_manager_shares integer;
  v_quorum integer; v_rules text; v_id uuid; v_membership uuid; v_cycle uuid; v_period uuid;
  v_i integer; v_days_base integer; v_days_rem integer; v_day_count integer; v_cursor date;
  v_amount_base bigint; v_amount_rem integer; v_amount_left bigint; v_period_amount bigint;
  v_share_no integer; v_profile_completed boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
  SELECT profile_completed INTO v_profile_completed FROM public.profiles WHERE id=v_uid;
  IF NOT coalesce(v_profile_completed,false) THEN
    RAISE EXCEPTION 'أكمل بيانات حسابك قبل إنشاء الجمعية' USING ERRCODE='42501';
  END IF;
  v_name:=nullif(btrim(p_payload->>'name'),'');
  v_currency:=p_payload->>'currency';
  v_start:=nullif(p_payload->>'startDate','')::date;
  v_first_draw:=nullif(p_payload->>'firstDrawOn','')::date;
  v_days:=CASE WHEN v_start IS NOT NULL AND v_first_draw IS NOT NULL THEN v_first_draw-v_start ELSE NULL END;
  v_tz:=coalesce(nullif(p_payload->>'timeZone',''),nullif(p_payload->>'tz',''),'Asia/Aden');
  v_amount:=nullif(p_payload->>'shareAmountMinor','')::bigint;
  v_mode:=coalesce(nullif(p_payload->>'installmentMode',''),'count');
  v_manager_participates:=coalesce((p_payload->>'managerParticipates')::boolean,false);
  v_manager_shares:=CASE WHEN v_manager_participates THEN coalesce(nullif(p_payload->>'managerShares','')::integer,0) ELSE 0 END;
  v_quorum:=coalesce(nullif(p_payload->>'quorum','')::integer,66);
  v_rules:=coalesce(p_payload->>'rules','');
  IF v_name IS NULL OR length(v_name) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'اسم الجمعية غير صالح' USING ERRCODE='22023'; END IF;
  IF v_currency NOT IN ('YER','SAR','USD') THEN RAISE EXCEPTION 'العملة غير مدعومة' USING ERRCODE='22023'; END IF;
  IF v_start IS NULL OR v_first_draw IS NULL OR v_days NOT BETWEEN 1 AND 3650 THEN RAISE EXCEPTION 'تاريخ البداية وأول قرعة غير صالحين' USING ERRCODE='22023'; END IF;
  IF v_amount IS NULL OR v_amount<=0 THEN RAISE EXCEPTION 'قيمة حصة السهم يجب أن تكون موجبة' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=v_tz) THEN RAISE EXCEPTION 'المنطقة الزمنية غير معروفة' USING ERRCODE='22023'; END IF;
  IF v_quorum NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'نصاب الحضور غير صالح' USING ERRCODE='22023'; END IF;
  IF v_manager_participates AND v_manager_shares<1 THEN RAISE EXCEPTION 'أدخل عدد أسهم المدير عند اختيار مشاركته' USING ERRCODE='22023'; END IF;
  IF NOT v_manager_participates AND v_manager_shares<>0 THEN RAISE EXCEPTION 'لا تقبل أسهم للمدير عند اختيار مدير فقط' USING ERRCODE='22023'; END IF;
  IF length(v_rules)>4000 THEN RAISE EXCEPTION 'نص قواعد الجمعية طويل جدًا' USING ERRCODE='22023'; END IF;
  IF v_mode='count' THEN
    v_installments:=nullif(p_payload->>'installments','')::integer; v_installment_amount:=NULL;
    IF v_installments IS NULL OR v_installments<1 OR v_installments>v_days THEN RAISE EXCEPTION 'عدد الأقساط غير صالح' USING ERRCODE='22023'; END IF;
  ELSIF v_mode='amount' THEN
    v_installment_amount:=nullif(p_payload->>'installmentAmountMinor','')::bigint;
    IF v_installment_amount IS NULL OR v_installment_amount<1 OR v_installment_amount>v_amount THEN RAISE EXCEPTION 'قيمة القسط غير صالحة' USING ERRCODE='22023'; END IF;
    v_installments:=ceil(v_amount::numeric/v_installment_amount)::integer;
    IF v_installments<1 OR v_installments>v_days THEN RAISE EXCEPTION 'عدد الأقساط الناتج يتجاوز مدة الدورة' USING ERRCODE='22023'; END IF;
  ELSE RAISE EXCEPTION 'طريقة السداد غير مدعومة' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.associations(
    manager_user_id,name,currency,start_date,first_draw_on,invite_opens_on,invite_closes_on,
    time_zone,cycle_type,cycle_days,share_amount_minor,installments_count,installment_mode,
    installment_amount_minor,target_shares,max_shares_per_member,manager_participates,quorum_percent,rules
  ) VALUES(
    v_uid,v_name,v_currency,v_start,v_first_draw,
    nullif(p_payload->>'inviteOpensOn','')::date,nullif(p_payload->>'inviteClosesOn','')::date,
    v_tz,'custom',v_days,v_amount,v_installments,v_mode,v_installment_amount,
    NULL,NULL,v_manager_participates,v_quorum,v_rules
  ) RETURNING id INTO v_id;
  INSERT INTO public.association_notification_settings(association_id,updated_by_user_id) VALUES(v_id,v_uid);
  IF v_manager_participates THEN
    INSERT INTO public.association_memberships(association_id,user_id) VALUES(v_id,v_uid) RETURNING id INTO v_membership;
    SELECT coalesce(max(share_no),0) INTO v_share_no FROM public.shares WHERE association_id=v_id;
    INSERT INTO public.shares(association_id,membership_id,share_no)
      SELECT v_id,v_membership,v_share_no+n FROM generate_series(1,v_manager_shares) AS n;
  END IF;
  INSERT INTO public.association_cycles(
    association_id,cycle_no,starts_on,ends_on,duration_days,currency,share_amount_minor,
    installments_count,cycle_type,installment_mode,installment_amount_minor
  ) VALUES(
    v_id,1,v_start,v_first_draw-1,v_days,v_currency,v_amount,v_installments,'custom',v_mode,v_installment_amount
  ) RETURNING id INTO v_cycle;
  v_days_base:=v_days/v_installments; v_days_rem:=v_days%v_installments;
  v_amount_base:=CASE WHEN v_mode='count' THEN v_amount/v_installments ELSE v_installment_amount END;
  v_amount_rem:=CASE WHEN v_mode='count' THEN (v_amount%v_installments)::integer ELSE 0 END;
  v_amount_left:=v_amount; v_cursor:=v_start;
  FOR v_i IN 1..v_installments LOOP
    v_day_count:=v_days_base+CASE WHEN v_i<=v_days_rem THEN 1 ELSE 0 END;
    IF v_mode='count' THEN v_period_amount:=v_amount_base+CASE WHEN v_i<=v_amount_rem THEN 1 ELSE 0 END;
    ELSE v_period_amount:=least(v_installment_amount,v_amount_left); v_amount_left:=v_amount_left-v_period_amount;
    END IF;
    INSERT INTO public.installment_periods(association_id,cycle_id,installment_no,starts_on,ends_on,per_share_amount_minor)
    VALUES(v_id,v_cycle,v_i,v_cursor,v_cursor+v_day_count-1,v_period_amount) RETURNING id INTO v_period;
    IF v_manager_participates THEN
      INSERT INTO public.installment_obligations(association_id,cycle_id,membership_id,period_id,shares_count,amount_minor,currency)
      VALUES(v_id,v_cycle,v_membership,v_period,v_manager_shares,v_period_amount*v_manager_shares,v_currency);
    END IF;
    v_cursor:=v_cursor+v_day_count;
  END LOOP;
  INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data)
  VALUES(v_id,v_uid,'association_created','association',v_id,'all',
    jsonb_build_object('name',v_name,'currency',v_currency,'start_date',v_start,'first_draw_on',v_first_draw,
      'cycle_days',v_days,'share_amount_minor',v_amount,'installment_mode',v_mode,
      'installments_count',v_installments,'manager_participates',v_manager_participates));
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION private.create_association_unified(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.create_association_unified(jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.create_association_unified(p_payload jsonb)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$ SELECT private.create_association_unified(p_payload); $function$;
REVOKE ALL ON FUNCTION public.create_association_unified(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_association_unified(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION private.create_invitation(p_association_id uuid,p_name text,p_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_a public.associations%ROWTYPE; v_token text; v_id uuid; v_phone text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
  SELECT * INTO v_a FROM public.associations WHERE id=p_association_id AND manager_user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الجمعية غير موجودة أو لا تملك صلاحية إدارتها' USING ERRCODE='42501'; END IF;
  PERFORM private.assert_association_join_open(p_association_id);
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'اسم المدعو غير صالح' USING ERRCODE='22023'; END IF;
  v_phone:=CASE WHEN nullif(btrim(p_phone),'') IS NULL THEN NULL ELSE private.normalize_phone_e164(p_phone) END;
  IF v_phone IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.invitations i WHERE i.association_id=p_association_id AND i.invitee_phone_e164=v_phone
      AND i.status='pending' AND i.response_status IN ('pending_response','interested','deferred')
      AND (i.expires_at IS NULL OR i.expires_at>now())
  ) THEN RAISE EXCEPTION 'توجد دعوة فعالة لهذا الرقم في الجمعية' USING ERRCODE='23505'; END IF;
  v_token:=encode(extensions.digest(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8'),'sha256'),'hex');
  INSERT INTO public.invitations(association_id,created_by,invitee_name,invitee_phone_e164,shares_requested,token_hash,status,response_status,expires_at)
  VALUES(p_association_id,v_uid,btrim(p_name),v_phone,NULL,
    encode(extensions.digest(convert_to(v_token,'UTF8'),'sha256'),'hex'),'pending','pending_response',now()+interval '30 days')
  RETURNING id INTO v_id;
  INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data)
  VALUES(p_association_id,v_uid,'invitation_created','invitation',v_id,'manager',
    jsonb_build_object('invitee_name',btrim(p_name),'share_count_assigned',false));
  RETURN jsonb_build_object('id',v_id,'token',v_token,'expires_in_days',30);
END;
$function$;
REVOKE ALL ON FUNCTION private.create_invitation(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.create_invitation(uuid,text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.create_invitation(p_association_id uuid,p_name text,p_phone text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$ SELECT private.create_invitation(p_association_id,p_name,p_phone); $function$;
REVOKE ALL ON FUNCTION public.create_invitation(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_invitation(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION private.respond_to_invitation(p_invitation_id uuid,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_inv public.invitations%ROWTYPE; v_phone text; v_completed boolean; v_next text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
  SELECT p.profile_completed,pp.phone_e164 INTO v_completed,v_phone FROM public.profiles p
  LEFT JOIN public.profile_private pp ON pp.user_id=p.id WHERE p.id=v_uid;
  IF NOT coalesce(v_completed,false) THEN RAISE EXCEPTION 'أكمل بيانات حسابك قبل الرد على الدعوة' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_inv FROM public.invitations WHERE id=p_invitation_id AND status='pending' FOR UPDATE;
  IF NOT FOUND OR (v_inv.expires_at IS NOT NULL AND v_inv.expires_at<=now()) THEN RAISE EXCEPTION 'الدعوة غير موجودة أو منتهية' USING ERRCODE='22023'; END IF;
  IF v_inv.invited_user_id IS NOT NULL AND v_inv.invited_user_id<>v_uid THEN RAISE EXCEPTION 'هذه الدعوة مخصصة لحساب آخر' USING ERRCODE='42501'; END IF;
  IF v_inv.invitee_phone_e164 IS NOT NULL AND v_inv.invitee_phone_e164 IS DISTINCT FROM v_phone THEN RAISE EXCEPTION 'الدعوة لا تطابق رقم الهاتف المسجل في حسابك' USING ERRCODE='42501'; END IF;
  IF v_inv.response_status NOT IN ('pending_response','deferred') THEN RAISE EXCEPTION 'سبق تسجيل رد نهائي على هذه الدعوة' USING ERRCODE='23514'; END IF;
  IF p_action='interested' THEN PERFORM private.assert_association_join_open(v_inv.association_id); v_next:='interested';
  ELSIF p_action='decline' THEN v_next:='declined';
  ELSIF p_action='defer' THEN v_next:='deferred';
  ELSE RAISE EXCEPTION 'إجراء الرد غير صالح' USING ERRCODE='22023'; END IF;
  UPDATE public.invitations SET response_status=v_next,invited_user_id=v_uid,responded_at=now() WHERE id=v_inv.id;
  INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data)
  VALUES(v_inv.association_id,v_uid,CASE v_next WHEN 'interested' THEN 'invitation_interested' WHEN 'declined' THEN 'invitation_declined' ELSE 'invitation_deferred' END,
    'invitation',v_inv.id,'manager',jsonb_build_object('response_status',v_next));
  RETURN jsonb_build_object('invitation_id',v_inv.id,'response_status',v_next);
END;
$function$;
REVOKE ALL ON FUNCTION private.respond_to_invitation(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.respond_to_invitation(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.respond_to_invitation(p_invitation_id uuid,p_action text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$ SELECT private.respond_to_invitation(p_invitation_id,p_action); $function$;
REVOKE ALL ON FUNCTION public.respond_to_invitation(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.respond_to_invitation(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION private.preview_invitation(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_result jsonb; v_phone text; v_completed boolean; v_invitation_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
  IF p_token IS NULL OR length(p_token)<40 THEN RAISE EXCEPTION 'رمز الدعوة غير صالح' USING ERRCODE='22023'; END IF;
  SELECT p.profile_completed,pp.phone_e164 INTO v_completed,v_phone FROM public.profiles p
  LEFT JOIN public.profile_private pp ON pp.user_id=p.id WHERE p.id=v_uid;
  IF NOT coalesce(v_completed,false) THEN RAISE EXCEPTION 'أكمل بيانات حسابك قبل فتح الدعوة' USING ERRCODE='42501'; END IF;
  SELECT i.id INTO v_invitation_id FROM public.invitations i
  WHERE i.token_hash=encode(extensions.digest(convert_to(p_token,'UTF8'),'sha256'),'hex')
    AND i.status='pending' AND i.response_status IN ('pending_response','interested','deferred')
    AND (i.expires_at IS NULL OR i.expires_at>now())
    AND (i.invited_user_id IS NULL OR i.invited_user_id=v_uid)
    AND (i.invitee_phone_e164 IS NULL OR i.invitee_phone_e164=v_phone)
    AND NOT EXISTS(SELECT 1 FROM public.association_memberships m WHERE m.association_id=i.association_id AND m.user_id=v_uid);
  IF v_invitation_id IS NULL THEN RAISE EXCEPTION 'الدعوة غير موجودة أو منتهية أو غير متاحة لهذا الحساب' USING ERRCODE='22023'; END IF;
  PERFORM private.assert_association_join_open((SELECT association_id FROM public.invitations WHERE id=v_invitation_id));
  SELECT jsonb_build_object(
    'ok',true,'invitationId',i.id,'name',a.name,'managerName',p.full_name,'currency',a.currency,
    'startDate',a.start_date,'firstDrawOn',a.first_draw_on,'cycleDays',a.cycle_days,'cycleType',a.cycle_type,
    'installmentMode',a.installment_mode,'installmentAmountMinor',a.installment_amount_minor,
    'installments',a.installments_count,'shareAmountMinor',a.share_amount_minor,'responseStatus',i.response_status,
    'sharesRequested',i.shares_requested,'isLegacyInvitation',(i.shares_requested IS NOT NULL),
    'assignedShares',(SELECT count(*) FROM public.shares s WHERE s.association_id=a.id AND s.status='active'),
    'targetShares',a.target_shares,'maxSharesPerMember',a.max_shares_per_member,'expiresAt',i.expires_at
  ) INTO v_result
  FROM public.invitations i JOIN public.associations a ON a.id=i.association_id
  JOIN public.profiles p ON p.id=a.manager_user_id WHERE i.id=v_invitation_id;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION private.accept_invitation(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
  v_uid uuid:=auth.uid(); v_inv public.invitations%ROWTYPE; v_assoc public.associations%ROWTYPE;
  v_membership uuid; v_share_no integer; v_added integer:=0; v_cycle record; v_period record;
  v_event uuid; v_phone text; v_completed boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
  IF p_token IS NULL OR length(p_token)<40 THEN RAISE EXCEPTION 'رمز الدعوة غير صالح' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_inv FROM public.invitations
  WHERE token_hash=encode(extensions.digest(convert_to(p_token,'UTF8'),'sha256'),'hex')
    AND status='pending' AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الدعوة غير موجودة أو منتهية أو سبق استخدامها' USING ERRCODE='22023'; END IF;
  IF v_inv.shares_requested IS NULL THEN RAISE EXCEPTION 'هذه دعوة بالنموذج الجديد؛ أرسل طلب الانضمام بعد تحديد أسهمك' USING ERRCODE='23514'; END IF;
  SELECT p.profile_completed,pp.phone_e164 INTO v_completed,v_phone FROM public.profiles p
  LEFT JOIN public.profile_private pp ON pp.user_id=p.id WHERE p.id=v_uid;
  IF NOT coalesce(v_completed,false) THEN RAISE EXCEPTION 'أكمل بياناتك الشخصية قبل قبول الدعوة' USING ERRCODE='23514'; END IF;
  IF v_inv.invitee_phone_e164 IS NOT NULL AND v_inv.invitee_phone_e164 IS DISTINCT FROM v_phone THEN RAISE EXCEPTION 'رقم الهاتف في الدعوة لا يطابق رقم هاتف حسابك' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_assoc FROM public.associations WHERE id=v_inv.association_id FOR UPDATE;
  IF v_assoc.locked_at IS NOT NULL OR v_assoc.status<>'active' THEN RAISE EXCEPTION 'أُغلقت العضويات بعد تثبيت أول قرعة' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM public.association_memberships WHERE association_id=v_assoc.id AND user_id=v_uid) THEN RAISE EXCEPTION 'هذا الحساب عضو بالفعل في الجمعية' USING ERRCODE='23505'; END IF;
  IF v_assoc.max_shares_per_member IS NOT NULL AND v_inv.shares_requested>v_assoc.max_shares_per_member THEN RAISE EXCEPTION 'عدد الأسهم يتجاوز الحد المسموح للفرد' USING ERRCODE='23514'; END IF;
  IF v_assoc.target_shares IS NOT NULL THEN
    SELECT count(*) INTO v_share_no FROM public.shares WHERE association_id=v_assoc.id AND status='active';
    IF v_share_no+v_inv.shares_requested>v_assoc.target_shares THEN RAISE EXCEPTION 'لم تعد هناك أسهم متاحة بهذا العدد' USING ERRCODE='23514'; END IF;
  END IF;
  INSERT INTO public.association_memberships(association_id,user_id) VALUES(v_assoc.id,v_uid) RETURNING id INTO v_membership;
  SELECT coalesce(max(share_no),0) INTO v_share_no FROM public.shares WHERE association_id=v_assoc.id;
  FOR v_added IN 1..v_inv.shares_requested LOOP
    INSERT INTO public.shares(association_id,membership_id,share_no) VALUES(v_assoc.id,v_membership,v_share_no+v_added);
  END LOOP;
  FOR v_cycle IN SELECT * FROM public.association_cycles WHERE association_id=v_assoc.id ORDER BY cycle_no LOOP
    FOR v_period IN SELECT * FROM public.installment_periods WHERE cycle_id=v_cycle.id ORDER BY installment_no LOOP
      INSERT INTO public.installment_obligations(association_id,cycle_id,membership_id,period_id,shares_count,amount_minor,currency)
      VALUES(v_assoc.id,v_cycle.id,v_membership,v_period.id,v_inv.shares_requested,v_period.per_share_amount_minor*v_inv.shares_requested,v_cycle.currency)
      ON CONFLICT(membership_id,period_id) DO NOTHING;
    END LOOP;
  END LOOP;
  UPDATE public.invitations SET status='accepted',response_status='legacy_accepted',invited_user_id=v_uid,
    accepted_at=now(),responded_at=coalesce(responded_at,now()) WHERE id=v_inv.id;
  INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data)
  VALUES(v_assoc.id,v_uid,'member_joined','membership',v_membership,'all',
    jsonb_build_object('shares',v_inv.shares_requested,'legacy_invitation',true)) RETURNING id INTO v_event;
  IF EXISTS(SELECT 1 FROM public.association_notification_settings s WHERE s.association_id=v_assoc.id AND 'joined'=ANY(s.enabled_types)) THEN
    INSERT INTO public.chat_messages(association_id,kind,body,system_type,event_id)
    VALUES(v_assoc.id,'system','انضم عضو جديد إلى الجمعية','joined',v_event);
  END IF;
  RETURN jsonb_build_object('membership_id',v_membership,'association_id',v_assoc.id,'shares_added',v_inv.shares_requested);
END;
$function$;

CREATE OR REPLACE FUNCTION private.submit_join_request(p_source_type text,p_token text,p_requested_shares integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
  v_uid uuid:=auth.uid(); v_a public.associations%ROWTYPE; v_inv public.invitations%ROWTYPE;
  v_link private.association_public_links%ROWTYPE; v_phone text; v_completed boolean;
  v_invitation_id uuid; v_link_id uuid; v_estimate numeric; v_request_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
  IF p_requested_shares IS NULL OR p_requested_shares<1 THEN RAISE EXCEPTION 'عدد الأسهم المطلوب غير صالح' USING ERRCODE='22023'; END IF;
  IF p_token IS NULL OR length(p_token)<40 THEN RAISE EXCEPTION 'رابط الانضمام غير صالح' USING ERRCODE='22023'; END IF;
  SELECT p.profile_completed,pp.phone_e164 INTO v_completed,v_phone FROM public.profiles p
  LEFT JOIN public.profile_private pp ON pp.user_id=p.id WHERE p.id=v_uid;
  IF NOT coalesce(v_completed,false) THEN RAISE EXCEPTION 'أكمل بيانات حسابك قبل تقديم طلب الانضمام' USING ERRCODE='42501'; END IF;
  IF p_source_type='invitation' THEN
    SELECT * INTO v_inv FROM public.invitations
    WHERE token_hash=encode(extensions.digest(convert_to(p_token,'UTF8'),'sha256'),'hex')
      AND status='pending' AND response_status='interested'
      AND (expires_at IS NULL OR expires_at>now()) AND invited_user_id=v_uid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'الدعوة غير صالحة أو لم توافق على استكمال الانضمام' USING ERRCODE='22023'; END IF;
    IF v_inv.invitee_phone_e164 IS NOT NULL AND v_inv.invitee_phone_e164 IS DISTINCT FROM v_phone THEN RAISE EXCEPTION 'الدعوة لا تطابق رقم الهاتف المسجل في حسابك' USING ERRCODE='42501'; END IF;
    v_invitation_id:=v_inv.id; v_a:=private.assert_association_join_open(v_inv.association_id);
  ELSIF p_source_type='public_link' THEN
    SELECT * INTO v_link FROM private.association_public_links
    WHERE token_hash=encode(extensions.digest(convert_to(p_token,'UTF8'),'sha256'),'hex')
      AND status='active' AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'رابط الانضمام متوقف أو منتهي أو غير صالح' USING ERRCODE='22023'; END IF;
    v_link_id:=v_link.id; v_a:=private.assert_association_join_open(v_link.association_id);
  ELSE RAISE EXCEPTION 'مصدر طلب الانضمام غير صالح' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.associations WHERE id=v_a.id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.association_memberships WHERE association_id=v_a.id AND user_id=v_uid) THEN
    RAISE EXCEPTION 'لديك سجل عضوية سابق في هذه الجمعية' USING ERRCODE='23505';
  END IF;
  v_estimate:=v_a.share_amount_minor::numeric*p_requested_shares::numeric;
  IF v_estimate<1 OR v_estimate>9223372036854775807 THEN RAISE EXCEPTION 'قيمة الالتزام تتجاوز النطاق المسموح' USING ERRCODE='22003'; END IF;
  INSERT INTO public.join_requests(association_id,applicant_user_id,invitation_id,public_link_id,source_type,requested_shares,estimated_amount_minor,status)
  VALUES(v_a.id,v_uid,v_invitation_id,v_link_id,p_source_type,p_requested_shares,v_estimate::bigint,'pending')
  RETURNING id INTO v_request_id;
  INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data)
  VALUES(v_a.id,v_uid,'join_request_submitted','join_request',v_request_id,'manager',
    jsonb_build_object('requested_shares',p_requested_shares,'estimated_amount_minor',v_estimate::bigint,'source_type',p_source_type));
  RETURN jsonb_build_object('request_id',v_request_id,'association_id',v_a.id,'status','pending',
    'requested_shares',p_requested_shares,'estimated_amount_minor',v_estimate::bigint,'currency',v_a.currency,
    'installments_count',v_a.installments_count);
END;
$function$;
REVOKE ALL ON FUNCTION private.submit_join_request(text,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.submit_join_request(text,text,integer) TO authenticated;
CREATE OR REPLACE FUNCTION public.submit_join_request(p_source_type text,p_token text,p_requested_shares integer)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$ SELECT private.submit_join_request(p_source_type,p_token,p_requested_shares); $function$;
REVOKE ALL ON FUNCTION public.submit_join_request(text,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_join_request(text,text,integer) TO authenticated;

CREATE OR REPLACE FUNCTION private.cancel_join_request(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_req public.join_requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
  SELECT * INTO v_req FROM public.join_requests WHERE id=p_request_id AND applicant_user_id=v_uid FOR UPDATE;
  IF NOT FOUND OR v_req.status<>'pending' THEN RAISE EXCEPTION 'الطلب غير موجود أو لم يعد قابلًا للإلغاء' USING ERRCODE='23514'; END IF;
  UPDATE public.join_requests SET status='cancelled',decided_at=now(),decided_by_user_id=NULL,updated_at=now() WHERE id=p_request_id;
  INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data)
  VALUES(v_req.association_id,v_uid,'join_request_cancelled','join_request',p_request_id,'manager',jsonb_build_object('status','cancelled'));
  RETURN jsonb_build_object('request_id',p_request_id,'status','cancelled');
END;
$function$;
REVOKE ALL ON FUNCTION private.cancel_join_request(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.cancel_join_request(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.cancel_join_request(p_request_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$ SELECT private.cancel_join_request(p_request_id); $function$;
REVOKE ALL ON FUNCTION public.cancel_join_request(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cancel_join_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.approve_join_request(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
  v_uid uuid:=auth.uid(); v_req public.join_requests%ROWTYPE; v_a public.associations%ROWTYPE;
  v_membership uuid; v_share_no integer; v_event uuid; v_share_ids integer; v_member record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
  SELECT a.* INTO v_a FROM public.associations a JOIN public.join_requests r ON r.association_id=a.id
  WHERE r.id=p_request_id AND a.manager_user_id=v_uid FOR UPDATE OF a;
  IF NOT FOUND THEN RAISE EXCEPTION 'الطلب غير موجود أو لا تملك صلاحية إدارته' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_req FROM public.join_requests WHERE id=p_request_id AND association_id=v_a.id FOR UPDATE;
  IF NOT FOUND OR v_req.status<>'pending' THEN RAISE EXCEPTION 'تم التعامل مع الطلب مسبقًا أو لم يعد معلقًا' USING ERRCODE='23514'; END IF;
  PERFORM private.assert_association_join_open(v_a.id);
  IF EXISTS(SELECT 1 FROM public.association_memberships WHERE association_id=v_a.id AND user_id=v_req.applicant_user_id) THEN
    RAISE EXCEPTION 'لدى مقدم الطلب سجل عضوية سابق في الجمعية' USING ERRCODE='23505';
  END IF;
  IF v_req.source_type='invitation' AND NOT EXISTS(
    SELECT 1 FROM public.invitations WHERE id=v_req.invitation_id AND status='pending'
      AND response_status='interested' AND invited_user_id=v_req.applicant_user_id
      AND (expires_at IS NULL OR expires_at>now())
  ) THEN RAISE EXCEPTION 'الدعوة الأصلية لم تعد صالحة للاعتماد' USING ERRCODE='23514'; END IF;
  INSERT INTO public.association_memberships(association_id,user_id) VALUES(v_a.id,v_req.applicant_user_id) RETURNING id INTO v_membership;
  SELECT coalesce(max(share_no),0) INTO v_share_no FROM public.shares WHERE association_id=v_a.id;
  INSERT INTO public.shares(association_id,membership_id,share_no)
    SELECT v_a.id,v_membership,v_share_no+n FROM generate_series(1,v_req.requested_shares) AS n;
  v_share_ids:=v_req.requested_shares;
  INSERT INTO public.installment_obligations(association_id,cycle_id,membership_id,period_id,shares_count,amount_minor,currency)
  SELECT v_a.id,c.id,v_membership,p.id,v_req.requested_shares,
    (p.per_share_amount_minor::numeric*v_req.requested_shares::numeric)::bigint,c.currency
  FROM public.association_cycles c JOIN public.installment_periods p ON p.cycle_id=c.id AND p.association_id=v_a.id
  WHERE c.association_id=v_a.id ON CONFLICT(membership_id,period_id) DO NOTHING;
  UPDATE public.join_requests SET status='approved',decided_at=now(),decided_by_user_id=v_uid,
    membership_id=v_membership,updated_at=now() WHERE id=p_request_id;
  IF v_req.invitation_id IS NOT NULL THEN
    UPDATE public.invitations SET status='accepted',accepted_at=now() WHERE id=v_req.invitation_id AND status='pending';
  END IF;
  INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data)
  VALUES(v_a.id,v_uid,'join_request_approved','join_request',p_request_id,'manager',
    jsonb_build_object('membership_id',v_membership,'shares',v_share_ids,'estimated_amount_minor',v_req.estimated_amount_minor));
  INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data)
  VALUES(v_a.id,v_uid,'member_joined','membership',v_membership,'all',jsonb_build_object('shares',v_share_ids,'source','join_request'))
  RETURNING id INTO v_event;
  IF EXISTS(SELECT 1 FROM public.association_notification_settings s WHERE s.association_id=v_a.id AND 'joined'=ANY(s.enabled_types)) THEN
    INSERT INTO public.chat_messages(association_id,kind,body,system_type,event_id)
    VALUES(v_a.id,'system','تم اعتماد طلب انضمام عضو جديد','joined',v_event);
  END IF;
  INSERT INTO public.notifications(user_id,association_id,type,title,body,related_entity_id,idempotency_key)
  VALUES(v_req.applicant_user_id,v_a.id,'join_approved','تم قبول طلب انضمامك',
    'وافق مدير الجمعية على طلب انضمامك وتم اعتماد الأسهم المطلوبة',p_request_id,
    'join-request:'||p_request_id::text||':approved') ON CONFLICT(idempotency_key) DO NOTHING;
  RETURN jsonb_build_object('request_id',p_request_id,'membership_id',v_membership,'association_id',v_a.id,
    'shares_added',v_share_ids,'estimated_amount_minor',v_req.estimated_amount_minor,'status','approved');
END;
$function$;
REVOKE ALL ON FUNCTION private.approve_join_request(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.approve_join_request(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.approve_join_request(p_request_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$ SELECT private.approve_join_request(p_request_id); $function$;
REVOKE ALL ON FUNCTION public.approve_join_request(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_join_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.reject_join_request(p_request_id uuid,p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_req public.join_requests%ROWTYPE; v_reason text:=nullif(btrim(p_reason),'');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
  IF v_reason IS NOT NULL AND length(v_reason)>1000 THEN RAISE EXCEPTION 'سبب الرفض طويل جدًا' USING ERRCODE='22023'; END IF;
  SELECT r.* INTO v_req FROM public.join_requests r JOIN public.associations a ON a.id=r.association_id
  WHERE r.id=p_request_id AND a.manager_user_id=v_uid FOR UPDATE OF r;
  IF NOT FOUND OR v_req.status<>'pending' THEN RAISE EXCEPTION 'الطلب غير موجود أو لم يعد معلقًا' USING ERRCODE='23514'; END IF;
  UPDATE public.join_requests SET status='rejected',decided_at=now(),decided_by_user_id=v_uid,
    rejection_reason=v_reason,updated_at=now() WHERE id=p_request_id;
  INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data)
  VALUES(v_req.association_id,v_uid,'join_request_rejected','join_request',p_request_id,'manager',
    jsonb_build_object('status','rejected','reason',v_reason));
  INSERT INTO public.notifications(user_id,association_id,type,title,body,related_entity_id,idempotency_key)
  VALUES(v_req.applicant_user_id,v_req.association_id,'join_rejected','تم رفض طلب الانضمام',
    'رفض مدير الجمعية طلب انضمامك'||CASE WHEN v_reason IS NULL THEN '' ELSE ': '||v_reason END,
    p_request_id,'join-request:'||p_request_id::text||':rejected') ON CONFLICT(idempotency_key) DO NOTHING;
  RETURN jsonb_build_object('request_id',p_request_id,'status','rejected','reason',v_reason);
END;
$function$;
REVOKE ALL ON FUNCTION private.reject_join_request(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.reject_join_request(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.reject_join_request(p_request_id uuid,p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$ SELECT private.reject_join_request(p_request_id,p_reason); $function$;
REVOKE ALL ON FUNCTION public.reject_join_request(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reject_join_request(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION private.manage_association_public_link(p_association_id uuid,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_a public.associations%ROWTYPE; v_link_id uuid; v_token text; v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
  SELECT * INTO v_a FROM public.associations WHERE id=p_association_id AND manager_user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الجمعية غير موجودة أو لا تملك صلاحية إدارتها' USING ERRCODE='42501'; END IF;
  IF p_action IN ('create','rotate') THEN
    PERFORM private.assert_association_join_open(p_association_id);
    UPDATE private.association_public_links SET status='revoked',revoked_at=now(),rotated_at=now()
    WHERE association_id=p_association_id AND status IN ('active','paused');
    v_token:=encode(extensions.digest(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8'),'sha256'),'hex');
    INSERT INTO private.association_public_links(association_id,token_hash,status,created_by_user_id)
    VALUES(p_association_id,encode(extensions.digest(convert_to(v_token,'UTF8'),'sha256'),'hex'),'active',v_uid)
    RETURNING id INTO v_link_id;
    INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data)
    VALUES(p_association_id,v_uid,'public_link_created','public_link',v_link_id,'manager',jsonb_build_object('action',p_action));
    RETURN jsonb_build_object('id',v_link_id,'token',v_token,'status','active');
  ELSIF p_action='pause' THEN
    UPDATE private.association_public_links SET status='paused',paused_at=now()
    WHERE association_id=p_association_id AND status='active' RETURNING id INTO v_link_id; v_status:='paused';
  ELSIF p_action='resume' THEN
    PERFORM private.assert_association_join_open(p_association_id);
    UPDATE private.association_public_links SET status='active',paused_at=NULL
    WHERE association_id=p_association_id AND status='paused' RETURNING id INTO v_link_id; v_status:='active';
  ELSIF p_action='revoke' THEN
    UPDATE private.association_public_links SET status='revoked',revoked_at=now()
    WHERE association_id=p_association_id AND status IN ('active','paused') RETURNING id INTO v_link_id; v_status:='revoked';
  ELSE RAISE EXCEPTION 'إجراء إدارة الرابط غير صالح' USING ERRCODE='22023';
  END IF;
  IF v_link_id IS NULL THEN RAISE EXCEPTION 'لا يوجد رابط بحالة تسمح بتنفيذ هذا الإجراء' USING ERRCODE='23514'; END IF;
  INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data)
  VALUES(p_association_id,v_uid,'public_link_'||p_action,'public_link',v_link_id,'manager',jsonb_build_object('status',v_status));
  RETURN jsonb_build_object('id',v_link_id,'status',v_status);
END;
$function$;
REVOKE ALL ON FUNCTION private.manage_association_public_link(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.manage_association_public_link(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.manage_association_public_link(p_association_id uuid,p_action text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$ SELECT private.manage_association_public_link(p_association_id,p_action); $function$;
REVOKE ALL ON FUNCTION public.manage_association_public_link(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_association_public_link(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION private.preview_public_join_link(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_result jsonb; v_a public.associations%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(p_token)<40 THEN RAISE EXCEPTION 'رابط الانضمام غير صالح' USING ERRCODE='22023'; END IF;
  SELECT a.* INTO v_a FROM private.association_public_links l JOIN public.associations a ON a.id=l.association_id
  WHERE l.token_hash=encode(extensions.digest(convert_to(p_token,'UTF8'),'sha256'),'hex')
    AND l.status='active' AND (l.expires_at IS NULL OR l.expires_at>now());
  IF NOT FOUND THEN RAISE EXCEPTION 'رابط الانضمام متوقف أو منتهي أو غير صالح' USING ERRCODE='22023'; END IF;
  PERFORM private.assert_association_join_open(v_a.id);
  SELECT jsonb_build_object('associationId',a.id,'name',a.name,'managerName',p.full_name,'currency',a.currency,
    'startDate',a.start_date,'firstDrawOn',a.first_draw_on,'cycleDays',a.cycle_days,
    'shareAmountMinor',a.share_amount_minor,'installmentMode',a.installment_mode,
    'installmentAmountMinor',a.installment_amount_minor,'installments',a.installments_count,'rules',a.rules)
  INTO v_result FROM public.associations a JOIN public.profiles p ON p.id=a.manager_user_id WHERE a.id=v_a.id;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION private.preview_public_join_link(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.preview_public_join_link(text) TO anon,authenticated;
GRANT USAGE ON SCHEMA private TO anon;
CREATE OR REPLACE FUNCTION public.preview_public_join_link(p_token text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$ SELECT private.preview_public_join_link(p_token); $function$;
REVOKE ALL ON FUNCTION public.preview_public_join_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_public_join_link(text) TO anon,authenticated;

CREATE POLICY invitations_invitee_select ON public.invitations FOR SELECT TO authenticated
USING(
  invited_user_id=(SELECT auth.uid())
  OR invitee_phone_e164=(SELECT pp.phone_e164 FROM public.profile_private pp WHERE pp.user_id=(SELECT auth.uid()))
);

CREATE OR REPLACE FUNCTION private.rebuild_open_association_obligations(p_association_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
  v_cycle record; v_member record; v_i integer; v_days_base integer; v_days_rem integer;
  v_amount_base bigint; v_amount_rem integer; v_amount_left bigint; v_period_days integer;
  v_period_amount bigint; v_cursor date; v_period_id uuid;
BEGIN
  PERFORM private.assert_association_pre_financial(p_association_id);
  DELETE FROM public.installment_obligations WHERE association_id=p_association_id;
  DELETE FROM public.installment_periods WHERE association_id=p_association_id;
  FOR v_cycle IN SELECT c.* FROM public.association_cycles c WHERE c.association_id=p_association_id ORDER BY c.cycle_no LOOP
    v_days_base:=v_cycle.duration_days/v_cycle.installments_count; v_days_rem:=v_cycle.duration_days%v_cycle.installments_count;
    v_amount_base:=CASE WHEN v_cycle.installment_mode='count' THEN v_cycle.share_amount_minor/v_cycle.installments_count ELSE v_cycle.installment_amount_minor END;
    v_amount_rem:=CASE WHEN v_cycle.installment_mode='count' THEN (v_cycle.share_amount_minor%v_cycle.installments_count)::integer ELSE 0 END;
    v_amount_left:=v_cycle.share_amount_minor; v_cursor:=v_cycle.starts_on;
    FOR v_i IN 1..v_cycle.installments_count LOOP
      v_period_days:=v_days_base+CASE WHEN v_i<=v_days_rem THEN 1 ELSE 0 END;
      IF v_cycle.installment_mode='count' THEN v_period_amount:=v_amount_base+CASE WHEN v_i<=v_amount_rem THEN 1 ELSE 0 END;
      ELSE v_period_amount:=least(v_cycle.installment_amount_minor,v_amount_left); v_amount_left:=v_amount_left-v_period_amount; END IF;
      INSERT INTO public.installment_periods(association_id,cycle_id,installment_no,starts_on,ends_on,per_share_amount_minor)
      VALUES(p_association_id,v_cycle.id,v_i,v_cursor,v_cursor+v_period_days-1,v_period_amount) RETURNING id INTO v_period_id;
      FOR v_member IN
        SELECT m.id AS membership_id,count(s.id)::integer AS shares_count
        FROM public.association_memberships m JOIN public.shares s ON s.membership_id=m.id
          AND s.association_id=p_association_id AND s.status='active'
        WHERE m.association_id=p_association_id AND m.status='active' GROUP BY m.id
      LOOP
        INSERT INTO public.installment_obligations(association_id,cycle_id,membership_id,period_id,shares_count,amount_minor,currency)
        VALUES(p_association_id,v_cycle.id,v_member.membership_id,v_period_id,v_member.shares_count,v_period_amount*v_member.shares_count,v_cycle.currency);
      END LOOP;
      v_cursor:=v_cursor+v_period_days;
    END LOOP;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION private.perform_draw(p_association_id uuid,p_expected_round_no integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
  v_uid uuid:=auth.uid(); v_a public.associations%ROWTYPE; v_cycle public.association_cycles%ROWTYPE;
  v_round integer; v_total_shares integer; v_people integer; v_present integer; v_required integer;
  v_candidates uuid[]; v_n integer; v_limit bigint; v_rand bigint; v_bytes bytea; v_index integer;
  v_winner uuid; v_draw uuid; v_event uuid; v_cycle_no integer; v_installment_no integer;
  v_days_base integer; v_days_rem integer; v_amount_base bigint; v_amount_rem integer;
  v_amount_left bigint; v_period_days integer; v_period_amount bigint; v_cursor date; v_period uuid;
  v_member record; v_new_cycle uuid; v_cycle_start date;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
  IF p_expected_round_no IS NULL OR p_expected_round_no<1 THEN RAISE EXCEPTION 'رقم الجولة غير صالح' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_a FROM public.associations WHERE id=p_association_id AND manager_user_id=v_uid AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'القرعة متاحة لمدير الجمعية فقط' USING ERRCODE='42501'; END IF;
  SELECT count(*)+1 INTO v_round FROM public.draws WHERE association_id=p_association_id;
  IF v_round<>p_expected_round_no THEN RAISE EXCEPTION 'تم تحديث حالة القرعة؛ أعد تحميل الجولة الحالية' USING ERRCODE='40001'; END IF;
  SELECT * INTO v_cycle FROM public.association_cycles WHERE association_id=p_association_id AND cycle_no=v_round FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'دورة القرعة غير مهيأة' USING ERRCODE='23514'; END IF;
  IF (now() AT TIME ZONE v_a.time_zone)::date<v_cycle.ends_on+1 THEN RAISE EXCEPTION 'لم يحل موعد القرعة بعد' USING ERRCODE='22023'; END IF;
  SELECT count(*) INTO v_total_shares FROM public.shares WHERE association_id=p_association_id AND status='active';
  SELECT count(*) INTO v_people FROM public.association_memberships WHERE association_id=p_association_id AND status='active';
  SELECT count(*) INTO v_present FROM public.cycle_attendance ca JOIN public.association_memberships m ON m.id=ca.membership_id
  WHERE ca.association_id=p_association_id AND ca.cycle_id=v_cycle.id AND ca.present AND m.status='active';
  v_required:=ceil(v_people*v_a.quorum_percent/100.0)::integer;
  IF v_people=0 OR v_present<v_required THEN RAISE EXCEPTION 'لم يكتمل نصاب الحضور' USING ERRCODE='23514'; END IF;
  IF v_total_shares=0 THEN RAISE EXCEPTION 'لا توجد أسهم مؤهلة' USING ERRCODE='23514'; END IF;
  SELECT array_agg(s.id ORDER BY s.id) INTO v_candidates FROM public.shares s
  WHERE s.association_id=p_association_id AND s.status='active'
    AND NOT EXISTS(SELECT 1 FROM public.draws d WHERE d.winner_share_id=s.id);
  v_n:=coalesce(array_length(v_candidates,1),0);
  IF v_n=0 THEN RAISE EXCEPTION 'لا توجد أسهم مؤهلة لهذه القرعة' USING ERRCODE='23514'; END IF;
  v_limit:=floor(4294967296::numeric/v_n)::bigint*v_n;
  LOOP
    v_bytes:=extensions.gen_random_bytes(4);
    v_rand:=get_byte(v_bytes,0)::bigint*16777216+get_byte(v_bytes,1)::bigint*65536+get_byte(v_bytes,2)::bigint*256+get_byte(v_bytes,3)::bigint;
    EXIT WHEN v_rand<v_limit;
  END LOOP;
  v_index:=(v_rand%v_n)::integer+1; v_winner:=v_candidates[v_index];
  INSERT INTO public.draws(association_id,cycle_id,round_no,scheduled_on,winner_share_id,share_count_at_draw,
    eligible_count,prize_target_minor,quorum_people,quorum_required,algorithm_version)
  VALUES(p_association_id,v_cycle.id,v_round,v_cycle.ends_on+1,v_winner,v_total_shares,v_n,
    v_a.share_amount_minor*v_total_shares,v_people,v_required,'pgcrypto-rejection-v1') RETURNING id INTO v_draw;
  INSERT INTO public.draw_eligible_shares(association_id,draw_id,share_id)
  SELECT p_association_id,v_draw,x FROM unnest(v_candidates) AS x;
  UPDATE public.association_cycles SET status='drawn' WHERE id=v_cycle.id;
  IF v_round=1 THEN
    UPDATE public.associations SET locked_at=now(),locked_share_count=v_total_shares WHERE id=p_association_id AND locked_at IS NULL;
    FOR v_cycle_no IN 2..v_total_shares LOOP
      v_cycle_start:=v_a.start_date+(v_cycle_no-1)*v_a.cycle_days;
      INSERT INTO public.association_cycles(association_id,cycle_no,starts_on,ends_on,duration_days,currency,
        share_amount_minor,installments_count,cycle_type,installment_mode,installment_amount_minor)
      VALUES(p_association_id,v_cycle_no,v_cycle_start,v_cycle_start+v_a.cycle_days-1,v_a.cycle_days,v_a.currency,
        v_a.share_amount_minor,v_a.installments_count,v_a.cycle_type,v_a.installment_mode,v_a.installment_amount_minor)
      RETURNING id INTO v_new_cycle;
      v_days_base:=v_a.cycle_days/v_a.installments_count; v_days_rem:=v_a.cycle_days%v_a.installments_count;
      v_amount_base:=CASE WHEN v_a.installment_mode='count' THEN v_a.share_amount_minor/v_a.installments_count ELSE v_a.installment_amount_minor END;
      v_amount_rem:=CASE WHEN v_a.installment_mode='count' THEN (v_a.share_amount_minor%v_a.installments_count)::integer ELSE 0 END;
      v_amount_left:=v_a.share_amount_minor; v_cursor:=v_cycle_start;
      FOR v_installment_no IN 1..v_a.installments_count LOOP
        v_period_days:=v_days_base+CASE WHEN v_installment_no<=v_days_rem THEN 1 ELSE 0 END;
        IF v_a.installment_mode='count' THEN v_period_amount:=v_amount_base+CASE WHEN v_installment_no<=v_amount_rem THEN 1 ELSE 0 END;
        ELSE v_period_amount:=least(v_a.installment_amount_minor,v_amount_left); v_amount_left:=v_amount_left-v_period_amount; END IF;
        INSERT INTO public.installment_periods(association_id,cycle_id,installment_no,starts_on,ends_on,per_share_amount_minor)
        VALUES(p_association_id,v_new_cycle,v_installment_no,v_cursor,v_cursor+v_period_days-1,v_period_amount) RETURNING id INTO v_period;
        FOR v_member IN
          SELECT m.id,count(s.id)::integer AS shares_count FROM public.association_memberships m
          JOIN public.shares s ON s.membership_id=m.id AND s.status='active'
          WHERE m.association_id=p_association_id AND m.status='active' GROUP BY m.id
        LOOP
          INSERT INTO public.installment_obligations(association_id,cycle_id,membership_id,period_id,shares_count,amount_minor,currency)
          VALUES(p_association_id,v_new_cycle,v_member.id,v_period,v_member.shares_count,v_period_amount*v_member.shares_count,v_a.currency);
        END LOOP;
        v_cursor:=v_cursor+v_period_days;
      END LOOP;
    END LOOP;
  END IF;
  INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data)
  VALUES(p_association_id,v_uid,'draw_result','draw',v_draw,'all',
    jsonb_build_object('round',v_round,'winner_share_id',v_winner,'eligible_count',v_n,'prize_target_minor',v_a.share_amount_minor*v_total_shares))
  RETURNING id INTO v_event;
  IF EXISTS(SELECT 1 FROM public.association_notification_settings s WHERE s.association_id=p_association_id AND 'drawResult'=ANY(s.enabled_types)) THEN
    INSERT INTO public.chat_messages(association_id,kind,body,system_type,event_id)
    VALUES(p_association_id,'system','تم تثبيت نتيجة القرعة','drawResult',v_event);
  END IF;
  INSERT INTO public.notifications(user_id,association_id,type,title,body,related_entity_id,idempotency_key)
  SELECT m.user_id,p_association_id,'drawResult','نتيجة القرعة','تم تثبيت نتيجة قرعة الجمعية',v_draw,'draw:'||v_draw::text||':'||m.user_id::text
  FROM public.association_memberships m LEFT JOIN public.user_preferences up ON up.user_id=m.user_id
  WHERE m.association_id=p_association_id AND m.status='active' AND coalesce(up.notifications_enabled,true)=true
  ON CONFLICT(idempotency_key) DO NOTHING;
  RETURN jsonb_build_object('draw_id',v_draw,'round',v_round,'winner_share_id',v_winner,'eligible_count',v_n,'locked',(v_round=1));
END;
$function$;

CREATE OR REPLACE FUNCTION private.list_my_invitations()
RETURNS SETOF public.invitations LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $function$
SELECT i.* FROM public.invitations i
LEFT JOIN public.profile_private pp ON pp.user_id=(SELECT auth.uid())
WHERE (i.invited_user_id=(SELECT auth.uid()) OR (i.invitee_phone_e164 IS NOT NULL AND i.invitee_phone_e164=pp.phone_e164))
  AND i.status='pending' AND (i.expires_at IS NULL OR i.expires_at>now())
ORDER BY i.created_at DESC;
$function$;
REVOKE ALL ON FUNCTION private.list_my_invitations() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.list_my_invitations() TO authenticated;
CREATE OR REPLACE FUNCTION public.list_my_invitations()
RETURNS SETOF public.invitations LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$ SELECT * FROM private.list_my_invitations(); $function$;
REVOKE ALL ON FUNCTION public.list_my_invitations() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_my_invitations() TO authenticated;
