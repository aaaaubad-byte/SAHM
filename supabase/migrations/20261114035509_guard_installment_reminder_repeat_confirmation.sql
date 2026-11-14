-- Keep the six-hour reminder repeat confirmation consistent between local and remote modes.
-- The three-argument overload remains for older clients and defaults to no repeat confirmation.
CREATE OR REPLACE FUNCTION private.send_installment_reminders(
  p_cycle_id uuid,p_installment_no integer,p_membership_id uuid,p_confirm_repeat boolean
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid:=auth.uid(); v_aid uuid; v_zone text;
  v_period public.installment_periods%ROWTYPE; v_today date;
  v_batch uuid:=gen_random_uuid(); v_count integer:=0; v_row record;
  v_reminder uuid; v_last_sent_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
  SELECT c.association_id,a.time_zone INTO v_aid,v_zone
  FROM public.association_cycles c JOIN public.associations a ON a.id=c.association_id
  WHERE c.id=p_cycle_id;
  IF v_aid IS NULL OR NOT private.is_association_manager(v_aid) THEN
    RAISE EXCEPTION 'التذكير متاح لمدير الجمعية فقط' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_period FROM public.installment_periods
  WHERE cycle_id=p_cycle_id AND installment_no=p_installment_no;
  IF NOT FOUND THEN RAISE EXCEPTION 'فترة القسط غير موجودة' USING ERRCODE='P0002'; END IF;
  v_today:=(now() AT TIME ZONE v_zone)::date;

  IF NOT coalesce(p_confirm_repeat,false) THEN
    SELECT max(rem.sent_at) INTO v_last_sent_at
    FROM public.installment_obligations o
    JOIN public.association_memberships m ON m.id=o.membership_id AND m.status='active'
    LEFT JOIN public.installment_receipts r ON r.obligation_id=o.id AND r.status='active'
    LEFT JOIN public.association_user_preferences pref ON pref.association_id=v_aid AND pref.user_id=m.user_id
    LEFT JOIN public.user_preferences up ON up.user_id=m.user_id
    JOIN public.reminders rem ON rem.obligation_id=o.id AND rem.recipient_user_id=m.user_id
    WHERE o.association_id=v_aid AND o.period_id=v_period.id AND r.id IS NULL
      AND v_today>=v_period.starts_on
      AND (p_membership_id IS NULL OR o.membership_id=p_membership_id)
      AND coalesce(pref.mute_reminders,false)=false
      AND coalesce(up.notifications_enabled,true)=true
      AND rem.sent_at>=now()-interval '6 hours';
    IF v_last_sent_at IS NOT NULL THEN
      RAISE EXCEPTION 'أُرسل تذكير بهذا القسط خلال الساعات الست الماضية. هل تريد إرسال تذكير آخر؟'
        USING ERRCODE='RPT01',DETAIL=jsonb_build_object('lastAt',v_last_sent_at)::text;
    END IF;
  END IF;

  FOR v_row IN
    SELECT o.id,o.membership_id,m.user_id
    FROM public.installment_obligations o
    JOIN public.association_memberships m ON m.id=o.membership_id AND m.status='active'
    LEFT JOIN public.installment_receipts r ON r.obligation_id=o.id AND r.status='active'
    LEFT JOIN public.association_user_preferences pref ON pref.association_id=v_aid AND pref.user_id=m.user_id
    LEFT JOIN public.user_preferences up ON up.user_id=m.user_id
    WHERE o.association_id=v_aid AND o.period_id=v_period.id AND r.id IS NULL
      AND v_today>=v_period.starts_on
      AND (p_membership_id IS NULL OR o.membership_id=p_membership_id)
      AND coalesce(pref.mute_reminders,false)=false
      AND coalesce(up.notifications_enabled,true)=true
  LOOP
    INSERT INTO public.reminders(association_id,obligation_id,recipient_user_id,sent_by_user_id,batch_id)
    VALUES(v_aid,v_row.id,v_row.user_id,v_uid,v_batch) RETURNING id INTO v_reminder;
    INSERT INTO public.notifications(user_id,association_id,type,title,body,related_entity_id,idempotency_key)
    VALUES(v_row.user_id,v_aid,'reminder','تذكير بالقسط','لديك قسط مستحق أو متأخر في الجمعية',v_row.id,'reminder:'||v_reminder::text)
    ON CONFLICT(idempotency_key) DO NOTHING;
    v_count:=v_count+1;
  END LOOP;

  INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data)
  VALUES(v_aid,v_uid,'reminders_sent','installment_period',v_period.id,'manager',
    jsonb_build_object('recipients',v_count,'batch_id',v_batch,'repeat_confirmed',coalesce(p_confirm_repeat,false)));
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION private.send_installment_reminders(
 p_cycle_id uuid,p_installment_no integer,p_membership_id uuid DEFAULT NULL::uuid
)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $function$
 SELECT private.send_installment_reminders(p_cycle_id,p_installment_no,p_membership_id,false);
$function$;

CREATE OR REPLACE FUNCTION public.send_installment_reminders(
 p_cycle_id uuid,p_installment_no integer,p_membership_id uuid,p_confirm_repeat boolean
)
RETURNS integer LANGUAGE sql SET search_path TO ''
AS $function$
 SELECT private.send_installment_reminders(p_cycle_id,p_installment_no,p_membership_id,p_confirm_repeat);
$function$;

REVOKE EXECUTE ON FUNCTION private.send_installment_reminders(uuid,integer,uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.send_installment_reminders(uuid,integer,uuid,boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.send_installment_reminders(uuid,integer,uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_installment_reminders(uuid,integer,uuid,boolean) TO authenticated;
