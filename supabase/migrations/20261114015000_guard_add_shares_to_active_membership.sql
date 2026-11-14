-- Prevent adding active shares to a membership that has already left.
-- Lock order matches remove_member: association first, then membership.
CREATE OR REPLACE FUNCTION private.add_shares(p_membership_id uuid, p_count integer)
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
  v_total_shares integer;
  v_last_no integer;
  v_i integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000';
  END IF;

  SELECT association_id INTO v_aid
  FROM public.association_memberships
  WHERE id=p_membership_id;

  IF v_aid IS NULL THEN
    RAISE EXCEPTION 'العضوية غير موجودة' USING ERRCODE='P0002';
  END IF;

  SELECT * INTO v_a
  FROM public.associations
  WHERE id=v_aid AND manager_user_id=v_uid AND status='active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'إضافة الأسهم متاحة لمدير الجمعية فقط' USING ERRCODE='42501';
  END IF;

  -- Recheck after taking the association lock and lock the membership row.
  -- This also closes the race with remove_member changing status to 'left'.
  PERFORM 1
  FROM public.association_memberships
  WHERE id=p_membership_id
    AND association_id=v_aid
    AND status='active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'لا يمكن إضافة أسهم إلى عضوية غير نشطة' USING ERRCODE='23514';
  END IF;

  IF v_a.locked_at IS NOT NULL
     OR EXISTS(SELECT 1 FROM public.draws WHERE association_id=v_aid)
     OR EXISTS(SELECT 1 FROM public.installment_receipts WHERE association_id=v_aid) THEN
    RAISE EXCEPTION 'لا يمكن إضافة الأسهم بعد قفل العضويات أو بدء السجل المالي' USING ERRCODE='23514';
  END IF;

  IF p_count IS NULL OR p_count<1 THEN
    RAISE EXCEPTION 'عدد الأسهم غير صالح' USING ERRCODE='22023';
  END IF;

  SELECT count(*) INTO v_member_shares
  FROM public.shares
  WHERE association_id=v_aid AND membership_id=p_membership_id AND status='active';

  SELECT count(*) INTO v_total_shares
  FROM public.shares
  WHERE association_id=v_aid AND status='active';

  SELECT coalesce(max(share_no),0) INTO v_last_no
  FROM public.shares
  WHERE association_id=v_aid;

  IF v_member_shares+p_count>v_a.max_shares_per_member
     OR v_total_shares+p_count>v_a.target_shares THEN
    RAISE EXCEPTION 'عدد الأسهم يتجاوز الحد المسموح للفرد أو العدد المستهدف' USING ERRCODE='23514';
  END IF;

  FOR v_i IN 1..p_count LOOP
    INSERT INTO public.shares(association_id,membership_id,share_no)
    VALUES(v_aid,p_membership_id,v_last_no+v_i);
  END LOOP;

  PERFORM private.rebuild_open_association_obligations(v_aid);

  INSERT INTO public.association_events(
    association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data
  )
  VALUES(v_aid,v_uid,'shares_added','membership',p_membership_id,'manager',
    jsonb_build_object('count',p_count));

  RETURN p_count;
END;
$function$;
