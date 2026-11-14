-- Batch invitations from the manager's selected contacts.
-- Results are per contact; successful invitations are not rolled back when a different contact fails.
CREATE OR REPLACE FUNCTION private.create_invitations_bulk(p_association_id uuid,p_invitees jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
  v_uid uuid:=auth.uid(); v_association public.associations%ROWTYPE; v_item jsonb;
  v_name text; v_phone text; v_invitation jsonb; v_results jsonb:='[]'::jsonb;
  v_sent integer:=0; v_failed integer:=0; v_total integer; v_existing_member boolean; v_error text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
  IF jsonb_typeof(p_invitees) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'قائمة جهات الاتصال غير صحيحة' USING ERRCODE='22023'; END IF;
  v_total:=jsonb_array_length(p_invitees);
  IF v_total<1 OR v_total>50 THEN RAISE EXCEPTION 'اختر من جهة اتصال واحدة إلى 50 جهة في العملية الواحدة' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_association FROM public.associations WHERE id=p_association_id AND manager_user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الجمعية غير موجودة أو لا تملك صلاحية إدارتها' USING ERRCODE='42501'; END IF;
  PERFORM private.assert_association_join_open(p_association_id);
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_invitees) LOOP
    v_name:=nullif(btrim(v_item->>'name'),''); v_phone:=nullif(btrim(v_item->>'phone'),'');
    v_error:=NULL; v_invitation:=NULL;
    IF v_name IS NULL OR length(v_name) NOT BETWEEN 2 AND 120 THEN v_error:='اسم جهة الاتصال غير صالح';
    ELSIF v_phone IS NULL THEN v_error:='رقم الهاتف مطلوب لإرسال الدعوة';
    ELSE
      BEGIN
        SELECT EXISTS(
          SELECT 1 FROM public.profile_private pp
          JOIN public.association_memberships m ON m.user_id=pp.user_id
          WHERE pp.phone_e164=private.normalize_phone_e164(v_phone)
            AND m.association_id=p_association_id AND m.status='active'
        ) INTO v_existing_member;
        IF v_existing_member THEN v_error:='هذا الشخص عضو بالفعل في الجمعية';
        ELSE v_invitation:=private.create_invitation(p_association_id,v_name,v_phone);
        END IF;
      EXCEPTION
        WHEN unique_violation THEN v_error:='توجد دعوة فعالة لهذا الرقم في الجمعية';
        WHEN OTHERS THEN
          v_error:=CASE SQLSTATE WHEN '22023' THEN 'رقم الهاتف أو بيانات جهة الاتصال غير صحيحة'
            WHEN '42501' THEN 'لا تملك صلاحية تنفيذ الدعوة'
            WHEN '23514' THEN 'الجمعية لا تستقبل الدعوات حاليًا'
            ELSE 'تعذر إرسال الدعوة إلى جهة الاتصال' END;
      END;
    END IF;
    IF v_invitation IS NOT NULL THEN
      v_sent:=v_sent+1;
      v_results:=v_results||jsonb_build_array(jsonb_build_object('status','sent','name',v_name,
        'invitationId',v_invitation->'id','token',v_invitation->'token','expiresInDays',v_invitation->'expires_in_days'));
    ELSE
      v_failed:=v_failed+1;
      v_results:=v_results||jsonb_build_array(jsonb_build_object('status','failed','name',coalesce(v_name,''),
        'message',coalesce(v_error,'تعذر إرسال الدعوة')));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('total',v_total,'sentCount',v_sent,'failedCount',v_failed,'results',v_results);
END;
$function$;
REVOKE ALL ON FUNCTION private.create_invitations_bulk(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.create_invitations_bulk(uuid,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.create_invitations_bulk(p_association_id uuid,p_invitees jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$ SELECT private.create_invitations_bulk(p_association_id,p_invitees); $function$;
REVOKE ALL ON FUNCTION public.create_invitations_bulk(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_invitations_bulk(uuid,jsonb) TO authenticated;

-- Preserve legacy share limits only where the old association still has them.
CREATE OR REPLACE FUNCTION private.guard_join_request_legacy_share_limits()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_target integer; v_max_per_member integer; v_assigned bigint;
BEGIN
  SELECT target_shares,max_shares_per_member INTO v_target,v_max_per_member
  FROM public.associations WHERE id=NEW.association_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الجمعية غير موجودة' USING ERRCODE='23503'; END IF;
  IF v_max_per_member IS NOT NULL AND NEW.requested_shares>v_max_per_member THEN
    RAISE EXCEPTION 'عدد الأسهم يتجاوز الحد التاريخي المسموح للفرد (%)',v_max_per_member USING ERRCODE='23514';
  END IF;
  SELECT count(*) INTO v_assigned FROM public.shares
  WHERE association_id=NEW.association_id AND status='active';
  IF TG_OP='INSERT' THEN
    IF v_target IS NOT NULL AND v_assigned+NEW.requested_shares>v_target THEN
      RAISE EXCEPTION 'عدد الأسهم يتجاوز المتبقي من السعة التاريخية للجمعية' USING ERRCODE='23514';
    END IF;
  ELSIF TG_OP='UPDATE' AND OLD.status='pending' AND NEW.status='approved' THEN
    IF v_target IS NOT NULL AND v_assigned>v_target THEN
      RAISE EXCEPTION 'تجاوز اعتماد الأسهم السعة التاريخية للجمعية' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.guard_join_request_legacy_share_limits() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS join_requests_guard_legacy_limits_insert ON public.join_requests;
CREATE TRIGGER join_requests_guard_legacy_limits_insert BEFORE INSERT ON public.join_requests
FOR EACH ROW EXECUTE FUNCTION private.guard_join_request_legacy_share_limits();
DROP TRIGGER IF EXISTS join_requests_guard_legacy_limits_approval ON public.join_requests;
CREATE TRIGGER join_requests_guard_legacy_limits_approval BEFORE UPDATE OF status ON public.join_requests
FOR EACH ROW WHEN (OLD.status='pending' AND NEW.status='approved')
EXECUTE FUNCTION private.guard_join_request_legacy_share_limits();
