CREATE OR REPLACE FUNCTION private.rebuild_open_association_obligations(p_association_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_cycle record; v_membership record; v_i integer;
  v_days_base integer; v_days_rem integer; v_amount_base bigint; v_amount_rem bigint;
  v_period_days integer; v_period_amount bigint; v_cursor date; v_period_id uuid;
BEGIN
  PERFORM private.assert_association_pre_financial(p_association_id);
  DELETE FROM public.installment_obligations WHERE association_id=p_association_id;
  DELETE FROM public.installment_periods WHERE association_id=p_association_id;
  FOR v_cycle IN SELECT c.* FROM public.association_cycles c WHERE c.association_id=p_association_id ORDER BY c.cycle_no LOOP
    v_days_base:=v_cycle.duration_days/v_cycle.installments_count;
    v_days_rem:=v_cycle.duration_days%v_cycle.installments_count;
    v_amount_base:=v_cycle.share_amount_minor/v_cycle.installments_count;
    v_amount_rem:=v_cycle.share_amount_minor%v_cycle.installments_count;
    v_cursor:=v_cycle.starts_on;
    FOR v_i IN 1..v_cycle.installments_count LOOP
      v_period_days:=v_days_base+CASE WHEN v_i<=v_days_rem THEN 1 ELSE 0 END;
      v_period_amount:=v_amount_base+CASE WHEN v_i<=v_amount_rem THEN 1 ELSE 0 END;
      INSERT INTO public.installment_periods(association_id,cycle_id,installment_no,starts_on,ends_on,per_share_amount_minor)
      VALUES(p_association_id,v_cycle.id,v_i,v_cursor,v_cursor+v_period_days-1,v_period_amount)
      RETURNING id INTO v_period_id;
      FOR v_membership IN
        SELECT m.id AS membership_id,count(s.id)::integer AS shares_count
        FROM public.association_memberships m JOIN public.shares s
          ON s.membership_id=m.id AND s.association_id=p_association_id AND s.status='active'
        WHERE m.association_id=p_association_id AND m.status='active' GROUP BY m.id
      LOOP
        INSERT INTO public.installment_obligations(association_id,cycle_id,membership_id,period_id,shares_count,amount_minor,currency)
        VALUES(p_association_id,v_cycle.id,v_membership.membership_id,v_period_id,
          v_membership.shares_count,v_period_amount*v_membership.shares_count,v_cycle.currency);
      END LOOP;
      v_cursor:=v_cursor+v_period_days;
    END LOOP;
  END LOOP;
END;
$function$


CREATE OR REPLACE FUNCTION private.remove_shares(p_membership_id uuid, p_count integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_aid uuid;
  v_a public.associations%ROWTYPE;
  v_member_shares integer;
  v_removed integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
  SELECT association_id INTO v_aid FROM public.association_memberships WHERE id=p_membership_id;
  IF v_aid IS NULL THEN RAISE EXCEPTION 'العضوية غير موجودة' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_a FROM public.associations
    WHERE id=v_aid AND manager_user_id=v_uid AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'تقليل الأسهم متاح لمدير الجمعية فقط' USING ERRCODE='42501'; END IF;
  IF v_a.locked_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.draws WHERE association_id=v_aid)
     OR EXISTS(SELECT 1 FROM public.installment_receipts WHERE association_id=v_aid) THEN
    RAISE EXCEPTION 'لا يمكن تقليل الأسهم بعد قفل العضويات أو بدء السجل المالي' USING ERRCODE='23514';
  END IF;
  SELECT count(*) INTO v_member_shares FROM public.shares
    WHERE association_id=v_aid AND membership_id=p_membership_id AND status='active';
  IF p_count IS NULL OR p_count<1 OR p_count>v_member_shares THEN
    RAISE EXCEPTION 'عدد الأسهم المطلوب تقليله غير صالح' USING ERRCODE='22023';
  END IF;
  WITH selected AS (
    SELECT id FROM public.shares
    WHERE association_id=v_aid AND membership_id=p_membership_id AND status='active'
    ORDER BY share_no DESC LIMIT p_count
  )
  UPDATE public.shares SET status='removed',removed_at=now()
  WHERE id IN (SELECT id FROM selected);
  GET DIAGNOSTICS v_removed=ROW_COUNT;
  PERFORM private.rebuild_open_association_obligations(v_aid);
  INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data)
  VALUES(v_aid,v_uid,'shares_removed','membership',p_membership_id,'manager',jsonb_build_object('count',v_removed));
  RETURN v_removed;
END;
$function$


CREATE OR REPLACE FUNCTION private.update_association(p_association_id uuid, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_a public.associations%ROWTYPE;
  v_name text;
  v_currency text;
  v_start date;
  v_tz text;
  v_cycle_type text;
  v_days integer;
  v_amount bigint;
  v_installments integer;
  v_target integer;
  v_max_per integer;
  v_quorum integer;
  v_rules text;
  v_active_shares integer;
  v_max_member_shares integer;
  v_manager_participates boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
  SELECT * INTO v_a FROM public.associations
  WHERE id=p_association_id AND manager_user_id=v_uid AND status='active'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الجمعية غير موجودة أو لا تملك صلاحية إدارتها' USING ERRCODE='42501'; END IF;
  IF v_a.locked_at IS NOT NULL OR EXISTS(
    SELECT 1 FROM public.draws WHERE association_id=p_association_id
  ) OR EXISTS(
    SELECT 1 FROM public.installment_receipts WHERE association_id=p_association_id
  ) THEN
    RAISE EXCEPTION 'لا يمكن تعديل إعدادات الجمعية بعد بدء السجل المالي أو تثبيت القرعة' USING ERRCODE='23514';
  END IF;

  v_name := coalesce(nullif(btrim(p_payload->>'name'),''),v_a.name);
  v_currency := coalesce(p_payload->>'currency',v_a.currency);
  v_start := coalesce(nullif(p_payload->>'startDate','')::date,v_a.start_date);
  v_tz := coalesce(nullif(p_payload->>'tz',''),v_a.time_zone);
  v_cycle_type := coalesce(p_payload->>'cycleType',v_a.cycle_type);
  v_days := CASE v_cycle_type
    WHEN 'weekly' THEN 7
    WHEN 'monthly' THEN 30
    WHEN 'custom' THEN coalesce(nullif(p_payload->>'cycleDays','')::integer,v_a.cycle_days)
    ELSE NULL END;
  v_amount := coalesce(nullif(p_payload->>'shareAmountMinor','')::bigint,v_a.share_amount_minor);
  v_installments := coalesce(nullif(p_payload->>'installments','')::integer,v_a.installments_count);
  v_target := coalesce(nullif(p_payload->>'targetShares','')::integer,v_a.target_shares);
  v_max_per := coalesce(nullif(p_payload->>'maxPerMember','')::integer,v_a.max_shares_per_member);
  v_quorum := coalesce(nullif(p_payload->>'quorum','')::integer,v_a.quorum_percent);
  v_rules := coalesce(p_payload->>'rules',v_a.rules);
  v_manager_participates := coalesce(nullif(p_payload->>'managerParticipates','')::boolean,v_a.manager_participates);

  IF length(v_name) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'اسم الجمعية غير صالح' USING ERRCODE='22023'; END IF;
  IF v_currency NOT IN ('YER','SAR','USD') THEN RAISE EXCEPTION 'العملة غير مدعومة' USING ERRCODE='22023'; END IF;
  IF v_days IS NULL OR v_days NOT BETWEEN 1 AND 3650 THEN RAISE EXCEPTION 'مدة الدورة غير صالحة' USING ERRCODE='22023'; END IF;
  IF v_amount<=0 OR v_installments NOT BETWEEN 1 AND v_days THEN RAISE EXCEPTION 'إعدادات الأقساط غير صالحة' USING ERRCODE='22023'; END IF;
  IF v_target<1 OR v_max_per NOT BETWEEN 1 AND v_target THEN RAISE EXCEPTION 'حدود الأسهم غير صالحة' USING ERRCODE='22023'; END IF;
  IF v_quorum NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'نصاب الحضور غير صالح' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=v_tz) THEN
    RAISE EXCEPTION 'المنطقة الزمنية غير معروفة' USING ERRCODE='22023';
  END IF;
  SELECT count(*) INTO v_active_shares FROM public.shares
    WHERE association_id=p_association_id AND status='active';
  SELECT coalesce(max(x.share_count),0) INTO v_max_member_shares FROM (
    SELECT count(*)::integer AS share_count FROM public.shares
    WHERE association_id=p_association_id AND status='active'
    GROUP BY membership_id
  ) x;
  IF v_active_shares>v_target OR v_max_member_shares>v_max_per THEN
    RAISE EXCEPTION 'الإعدادات الجديدة تتعارض مع الأسهم المسجلة حاليًا' USING ERRCODE='23514';
  END IF;
  IF v_manager_participates IS DISTINCT FROM v_a.manager_participates THEN
    RAISE EXCEPTION 'تغيير مشاركة المدير يحتاج تعديل العضوية والأسهم بصورة مستقلة' USING ERRCODE='22023';
  END IF;

  UPDATE public.associations SET
    name=v_name,currency=v_currency,start_date=v_start,
    invite_opens_on=coalesce(nullif(p_payload->>'inviteOpensOn','')::date,invite_opens_on),
    invite_closes_on=coalesce(nullif(p_payload->>'inviteClosesOn','')::date,invite_closes_on),
    time_zone=v_tz,cycle_type=v_cycle_type,cycle_days=v_days,
    share_amount_minor=v_amount,installments_count=v_installments,
    target_shares=v_target,max_shares_per_member=v_max_per,
    quorum_percent=v_quorum,rules=v_rules,updated_at=now()
  WHERE id=p_association_id;

  UPDATE public.association_cycles SET
    starts_on=v_start,ends_on=v_start+v_days-1,duration_days=v_days,
    currency=v_currency,share_amount_minor=v_amount,
    installments_count=v_installments,cycle_type=v_cycle_type
  WHERE association_id=p_association_id AND cycle_no=1;

  PERFORM private.rebuild_open_association_obligations(p_association_id);

  INSERT INTO public.association_events(
    association_id,actor_user_id,event_type,entity_type,entity_id,visibility,before_data,after_data
  ) VALUES (
    p_association_id,v_uid,'association_updated','association',p_association_id,'manager',
    jsonb_build_object('name',v_a.name,'currency',v_a.currency,'start_date',v_a.start_date,
      'cycle_type',v_a.cycle_type,'cycle_days',v_a.cycle_days,'share_amount_minor',v_a.share_amount_minor,
      'installments_count',v_a.installments_count,'target_shares',v_a.target_shares,
      'max_shares_per_member',v_a.max_shares_per_member,'quorum_percent',v_a.quorum_percent),
    jsonb_build_object('name',v_name,'currency',v_currency,'start_date',v_start,
      'cycle_type',v_cycle_type,'cycle_days',v_days,'share_amount_minor',v_amount,
      'installments_count',v_installments,'target_shares',v_target,
      'max_shares_per_member',v_max_per,'quorum_percent',v_quorum)
  );
  RETURN p_association_id;
END;
$function$


CREATE OR REPLACE FUNCTION private.update_my_profile(p_full_name text, p_city text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
  IF p_full_name IS NULL OR length(btrim(p_full_name)) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'الاسم الكامل غير صالح' USING ERRCODE='22023';
  END IF;
  UPDATE public.profiles SET full_name=btrim(p_full_name),updated_at=now() WHERE id=v_uid;
  UPDATE public.profile_private SET city=nullif(btrim(coalesce(p_city,'')),''),updated_at=now()
    WHERE user_id=v_uid;
  RETURN true;
END;
$function$


CREATE OR REPLACE FUNCTION public.add_shares(p_membership_id uuid, p_count integer)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT private.add_shares(p_membership_id,p_count); $function$


CREATE OR REPLACE FUNCTION public.cancel_invitation(p_invitation_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT private.cancel_invitation(p_invitation_id); $function$


CREATE OR REPLACE FUNCTION public.preview_invitation(p_token text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT private.preview_invitation(p_token); $function$


CREATE OR REPLACE FUNCTION public.remove_member(p_membership_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT private.remove_member(p_membership_id); $function$


CREATE OR REPLACE FUNCTION public.remove_shares(p_membership_id uuid, p_count integer)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT private.remove_shares(p_membership_id,p_count); $function$



REVOKE ALL ON FUNCTION private.rebuild_open_association_obligations(uuid),
 private.assert_association_pre_financial(uuid) FROM PUBLIC,anon,authenticated;
