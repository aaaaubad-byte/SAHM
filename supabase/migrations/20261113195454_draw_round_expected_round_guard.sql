CREATE SCHEMA IF NOT EXISTS private;

-- Atomic draw with explicit expected round to make retries/concurrent requests idempotent.
-- Implementation is kept in the non-exposed private schema; public.perform_draw is an invoker wrapper.
CREATE OR REPLACE FUNCTION private.perform_draw(p_association_id uuid, p_expected_round_no integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_uid uuid:=auth.uid(); v_a public.associations%ROWTYPE; v_cycle public.association_cycles%ROWTYPE;
 v_round integer; v_total_shares integer; v_people integer; v_present integer; v_required integer;
 v_candidates uuid[]; v_n integer; v_limit bigint; v_rand bigint; v_bytes bytea; v_index integer;
 v_winner uuid; v_draw uuid; v_event uuid; v_cycle_no integer; v_installment_no integer;
 v_days_base integer; v_days_rem integer; v_amount_base bigint; v_amount_rem bigint;
 v_pd integer; v_pa bigint; v_cursor date; v_period uuid; v_m record; v_c uuid; v_cycle_start date;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
 IF p_expected_round_no IS NULL OR p_expected_round_no<1 THEN RAISE EXCEPTION 'رقم الجولة غير صالح' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_a FROM public.associations WHERE id=p_association_id AND manager_user_id=v_uid AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'القرعة متاحة لمدير الجمعية فقط' USING ERRCODE='42501'; END IF;
 SELECT count(*)+1 INTO v_round FROM public.draws WHERE association_id=p_association_id;
 IF v_round<>p_expected_round_no THEN RAISE EXCEPTION 'تم تحديث حالة القرعة؛ أعد تحميل الجولة الحالية' USING ERRCODE='40001'; END IF;
 SELECT * INTO v_cycle FROM public.association_cycles WHERE association_id=p_association_id AND cycle_no=v_round FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'دورة القرعة غير مهيأة' USING ERRCODE='23514'; END IF;
 IF (now() AT TIME ZONE v_a.time_zone)::date < v_cycle.ends_on+1 THEN RAISE EXCEPTION 'لم يحل موعد القرعة بعد' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO v_total_shares FROM public.shares WHERE association_id=p_association_id AND status='active';
 SELECT count(*) INTO v_people FROM public.association_memberships WHERE association_id=p_association_id AND status='active';
 SELECT count(*) INTO v_present FROM public.cycle_attendance ca
 JOIN public.association_memberships m ON m.id=ca.membership_id
 WHERE ca.association_id=p_association_id AND ca.cycle_id=v_cycle.id AND ca.present AND m.status='active';
 v_required:=ceil(v_people*v_a.quorum_percent/100.0)::integer;
 IF v_people=0 OR v_present<v_required THEN RAISE EXCEPTION 'لم يكتمل نصاب الحضور' USING ERRCODE='23514'; END IF;
 IF v_total_shares=0 THEN RAISE EXCEPTION 'لا توجد أسهم مؤهلة' USING ERRCODE='23514'; END IF;
 SELECT array_agg(s.id ORDER BY s.id) INTO v_candidates
 FROM public.shares s WHERE s.association_id=p_association_id AND s.status='active'
 AND NOT EXISTS(SELECT 1 FROM public.draws d WHERE d.winner_share_id=s.id);
 v_n:=coalesce(array_length(v_candidates,1),0);
 IF v_n=0 THEN RAISE EXCEPTION 'لا توجد أسهم مؤهلة لهذه القرعة' USING ERRCODE='23514'; END IF;
 v_limit:=floor(4294967296::numeric/v_n)::bigint*v_n;
 LOOP
   v_bytes:=extensions.gen_random_bytes(4);
   v_rand:=get_byte(v_bytes,0)::bigint*16777216 + get_byte(v_bytes,1)::bigint*65536 + get_byte(v_bytes,2)::bigint*256 + get_byte(v_bytes,3)::bigint;
   EXIT WHEN v_rand<v_limit;
 END LOOP;
 v_index:=(v_rand%v_n)::integer+1;
 v_winner:=v_candidates[v_index];
 INSERT INTO public.draws(association_id,cycle_id,round_no,scheduled_on,winner_share_id,share_count_at_draw,eligible_count,prize_target_minor,quorum_people,quorum_required,algorithm_version)
 VALUES(p_association_id,v_cycle.id,v_round,v_cycle.ends_on+1,v_winner,v_total_shares,v_n,v_a.share_amount_minor*v_total_shares,v_people,v_required,'pgcrypto-rejection-v1')
 RETURNING id INTO v_draw;
 INSERT INTO public.draw_eligible_shares(association_id,draw_id,share_id)
 SELECT p_association_id,v_draw,x FROM unnest(v_candidates) AS x;
 UPDATE public.association_cycles SET status='drawn' WHERE id=v_cycle.id;
 IF v_round=1 THEN
   UPDATE public.associations SET locked_at=now(),locked_share_count=v_total_shares WHERE id=p_association_id AND locked_at IS NULL;
   FOR v_cycle_no IN 2..v_total_shares LOOP
     v_cycle_start:=v_a.start_date+(v_cycle_no-1)*v_a.cycle_days;
     INSERT INTO public.association_cycles(association_id,cycle_no,starts_on,ends_on,duration_days,currency,share_amount_minor,installments_count,cycle_type)
     VALUES(p_association_id,v_cycle_no,v_cycle_start,v_cycle_start+v_a.cycle_days-1,v_a.cycle_days,v_a.currency,v_a.share_amount_minor,v_a.installments_count,v_a.cycle_type)
     RETURNING id INTO v_c;
     v_days_base:=v_a.cycle_days/v_a.installments_count; v_days_rem:=v_a.cycle_days%v_a.installments_count;
     v_amount_base:=v_a.share_amount_minor/v_a.installments_count; v_amount_rem:=v_a.share_amount_minor%v_a.installments_count;
     v_cursor:=v_cycle_start;
     FOR v_installment_no IN 1..v_a.installments_count LOOP
       v_pd:=v_days_base+CASE WHEN v_installment_no<=v_days_rem THEN 1 ELSE 0 END;
       v_pa:=v_amount_base+CASE WHEN v_installment_no<=v_amount_rem THEN 1 ELSE 0 END;
       INSERT INTO public.installment_periods(association_id,cycle_id,installment_no,starts_on,ends_on,per_share_amount_minor)
       VALUES(p_association_id,v_c,v_installment_no,v_cursor,v_cursor+v_pd-1,v_pa) RETURNING id INTO v_period;
       FOR v_m IN
         SELECT m.id,count(s.id)::integer AS shares_count
         FROM public.association_memberships m JOIN public.shares s ON s.membership_id=m.id AND s.status='active'
         WHERE m.association_id=p_association_id AND m.status='active' GROUP BY m.id
       LOOP
         INSERT INTO public.installment_obligations(association_id,cycle_id,membership_id,period_id,shares_count,amount_minor,currency)
         VALUES(p_association_id,v_c,v_m.id,v_period,v_m.shares_count,v_pa*v_m.shares_count,v_a.currency);
       END LOOP;
       v_cursor:=v_cursor+v_pd;
     END LOOP;
   END LOOP;
 END IF;
 INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data)
 VALUES(p_association_id,v_uid,'draw_result','draw',v_draw,'all',jsonb_build_object('round',v_round,'winner_share_id',v_winner,'eligible_count',v_n,'prize_target_minor',v_a.share_amount_minor*v_total_shares))
 RETURNING id INTO v_event;
 IF EXISTS(SELECT 1 FROM public.association_notification_settings s WHERE s.association_id=p_association_id AND 'drawResult'=ANY(s.enabled_types)) THEN
   INSERT INTO public.chat_messages(association_id,kind,body,system_type,event_id)
   VALUES(p_association_id,'system','تم تثبيت نتيجة القرعة','drawResult',v_event);
 END IF;
 INSERT INTO public.notifications(user_id,association_id,type,title,body,related_entity_id,idempotency_key)
 SELECT m.user_id,p_association_id,'drawResult','نتيجة القرعة','تم تثبيت نتيجة قرعة الجمعية',v_draw,
        'draw:'||v_draw::text||':'||m.user_id::text
 FROM public.association_memberships m
 LEFT JOIN public.user_preferences up ON up.user_id=m.user_id
 WHERE m.association_id=p_association_id AND m.status='active' AND coalesce(up.notifications_enabled,true)=true
 ON CONFLICT(idempotency_key) DO NOTHING;
 RETURN jsonb_build_object('draw_id',v_draw,'round',v_round,'winner_share_id',v_winner,'eligible_count',v_n,'locked',(v_round=1));
END;
$function$

