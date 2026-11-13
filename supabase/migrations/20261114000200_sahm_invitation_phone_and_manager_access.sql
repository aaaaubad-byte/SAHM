-- Enforce invitation ownership by completed profile phone and allow non-participating managers to use group tools.
CREATE OR REPLACE FUNCTION private.accept_invitation(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
 v_uid uuid:=auth.uid(); v_inv public.invitations%ROWTYPE; v_assoc public.associations%ROWTYPE;
 v_membership uuid; v_share_no integer; v_added integer:=0; v_cycle record; v_period record; v_event uuid;
 v_phone text; v_completed boolean;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
 IF p_token IS NULL OR length(p_token)<40 THEN RAISE EXCEPTION 'رمز الدعوة غير صالح' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_inv FROM public.invitations
 WHERE token_hash=encode(extensions.digest(convert_to(p_token,'UTF8'),'sha256'),'hex')
   AND status='pending' AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'الدعوة غير موجودة أو منتهية أو سبق استخدامها' USING ERRCODE='22023'; END IF;
 SELECT p.profile_completed,pp.phone_e164 INTO v_completed,v_phone
 FROM public.profiles p LEFT JOIN public.profile_private pp ON pp.user_id=p.id
 WHERE p.id=v_uid;
 IF NOT coalesce(v_completed,false) THEN
   RAISE EXCEPTION 'أكمل بياناتك الشخصية قبل قبول الدعوة' USING ERRCODE='23514';
 END IF;
 IF v_inv.invitee_phone_e164 IS NOT NULL AND v_inv.invitee_phone_e164 IS DISTINCT FROM v_phone THEN
   RAISE EXCEPTION 'رقم الهاتف في الدعوة لا يطابق رقم هاتف حسابك' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_assoc FROM public.associations WHERE id=v_inv.association_id FOR UPDATE;
 IF v_assoc.locked_at IS NOT NULL OR v_assoc.status<>'active' THEN RAISE EXCEPTION 'أُغلقت العضويات بعد تثبيت أول قرعة' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.association_memberships WHERE association_id=v_assoc.id AND user_id=v_uid) THEN
   RAISE EXCEPTION 'هذا الحساب عضو بالفعل في الجمعية' USING ERRCODE='23505';
 END IF;
 IF v_inv.shares_requested>v_assoc.max_shares_per_member THEN RAISE EXCEPTION 'عدد الأسهم يتجاوز الحد المسموح للفرد' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO v_share_no FROM public.shares WHERE association_id=v_assoc.id AND status='active';
 IF v_share_no+v_inv.shares_requested>v_assoc.target_shares THEN RAISE EXCEPTION 'لم تعد هناك أسهم متاحة بهذا العدد' USING ERRCODE='23514'; END IF;
 INSERT INTO public.association_memberships(association_id,user_id) VALUES(v_assoc.id,v_uid) RETURNING id INTO v_membership;
 SELECT coalesce(max(share_no),0) INTO v_share_no FROM public.shares WHERE association_id=v_assoc.id;
 FOR v_added IN 1..v_inv.shares_requested LOOP
   INSERT INTO public.shares(association_id,membership_id,share_no) VALUES(v_assoc.id,v_membership,v_share_no+v_added);
 END LOOP;
 FOR v_cycle IN SELECT * FROM public.association_cycles WHERE association_id=v_assoc.id ORDER BY cycle_no LOOP
   FOR v_period IN SELECT * FROM public.installment_periods WHERE cycle_id=v_cycle.id ORDER BY installment_no LOOP
     INSERT INTO public.installment_obligations(association_id,cycle_id,membership_id,period_id,shares_count,amount_minor,currency)
     VALUES(v_assoc.id,v_cycle.id,v_membership,v_period.id,v_inv.shares_requested,
            v_period.per_share_amount_minor*v_inv.shares_requested,v_cycle.currency)
     ON CONFLICT(membership_id,period_id) DO NOTHING;
   END LOOP;
 END LOOP;
 UPDATE public.invitations SET status='accepted',invited_user_id=v_uid,accepted_at=now() WHERE id=v_inv.id;
 INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data)
 VALUES(v_assoc.id,v_uid,'member_joined','membership',v_membership,'all',jsonb_build_object('shares',v_inv.shares_requested)) RETURNING id INTO v_event;
 IF EXISTS(SELECT 1 FROM public.association_notification_settings s WHERE s.association_id=v_assoc.id AND 'joined'=ANY(s.enabled_types)) THEN
   INSERT INTO public.chat_messages(association_id,kind,body,system_type,event_id)
   VALUES(v_assoc.id,'system','انضم عضو جديد إلى الجمعية','joined',v_event);
 END IF;
 RETURN jsonb_build_object('membership_id',v_membership,'association_id',v_assoc.id,'shares_added',v_inv.shares_requested);
END;
$function$;

CREATE OR REPLACE FUNCTION private.send_chat_message(p_association_id uuid,p_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_message uuid; v_event uuid;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
 IF p_body IS NULL OR char_length(btrim(p_body)) NOT BETWEEN 1 AND 50 THEN
   RAISE EXCEPTION 'الرسالة يجب أن تكون من حرف إلى 50 حرفًا' USING ERRCODE='22023';
 END IF;
 IF NOT (private.is_association_member(p_association_id) OR private.is_association_manager(p_association_id)) THEN
   RAISE EXCEPTION 'المحادثة متاحة لأعضاء الجمعية ومديرها فقط' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,visibility,after_data)
 VALUES(p_association_id,v_uid,'chat_message_sent','chat_message','all',jsonb_build_object('body',btrim(p_body)))
 RETURNING id INTO v_event;
 INSERT INTO public.chat_messages(association_id,sender_user_id,kind,body,event_id)
 VALUES(p_association_id,v_uid,'member',btrim(p_body),v_event) RETURNING id INTO v_message;
 INSERT INTO public.notifications(user_id,association_id,type,title,body,related_entity_id,idempotency_key)
 SELECT m.user_id,p_association_id,'chat_message','رسالة جديدة','وصلت رسالة جديدة في محادثة الجمعية',v_message,
        'chat:'||v_message::text||':'||m.user_id::text
 FROM public.association_memberships m
 LEFT JOIN public.association_user_preferences pref ON pref.association_id=p_association_id AND pref.user_id=m.user_id
 LEFT JOIN public.user_preferences up ON up.user_id=m.user_id
 WHERE m.association_id=p_association_id AND m.status='active' AND m.user_id<>v_uid
   AND coalesce(pref.mute_group,false)=false AND coalesce(up.notifications_enabled,true)=true
 ON CONFLICT(idempotency_key) DO NOTHING;
 RETURN v_message;
END;
$function$;

CREATE OR REPLACE FUNCTION private.set_association_user_preferences(
 p_association_id uuid,p_mute_group boolean,p_mute_reminders boolean
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_uid uuid:=auth.uid();
BEGIN
 IF v_uid IS NULL OR NOT (private.is_association_member(p_association_id) OR private.is_association_manager(p_association_id)) THEN
   RAISE EXCEPTION 'تفضيلات الجمعية متاحة لأعضائها ومديرها فقط' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.association_user_preferences(association_id,user_id,mute_group,mute_reminders,updated_at)
 VALUES(p_association_id,v_uid,coalesce(p_mute_group,false),coalesce(p_mute_reminders,false),now())
 ON CONFLICT(association_id,user_id) DO UPDATE
 SET mute_group=excluded.mute_group,mute_reminders=excluded.mute_reminders,updated_at=now();
END;
$function$;

DROP POLICY IF EXISTS association_prefs_insert ON public.association_user_preferences;
DROP POLICY IF EXISTS association_prefs_select ON public.association_user_preferences;
DROP POLICY IF EXISTS association_prefs_update ON public.association_user_preferences;
CREATE POLICY association_prefs_insert ON public.association_user_preferences
 FOR INSERT TO authenticated
 WITH CHECK(user_id=(SELECT auth.uid()) AND
   (private.is_association_member(association_id) OR private.is_association_manager(association_id)));
CREATE POLICY association_prefs_select ON public.association_user_preferences
 FOR SELECT TO authenticated
 USING(user_id=(SELECT auth.uid()) AND
   (private.is_association_member(association_id) OR private.is_association_manager(association_id)));
CREATE POLICY association_prefs_update ON public.association_user_preferences
 FOR UPDATE TO authenticated
 USING(user_id=(SELECT auth.uid()) AND
   (private.is_association_member(association_id) OR private.is_association_manager(association_id)))
 WITH CHECK(user_id=(SELECT auth.uid()) AND
   (private.is_association_member(association_id) OR private.is_association_manager(association_id)));

DROP POLICY IF EXISTS chat_read_insert ON public.chat_read_states;
DROP POLICY IF EXISTS chat_read_update ON public.chat_read_states;
CREATE POLICY chat_read_insert ON public.chat_read_states
 FOR INSERT TO authenticated
 WITH CHECK(user_id=(SELECT auth.uid()) AND private.can_view_association(association_id));
CREATE POLICY chat_read_update ON public.chat_read_states
 FOR UPDATE TO authenticated
 USING(user_id=(SELECT auth.uid()) AND private.can_view_association(association_id))
 WITH CHECK(user_id=(SELECT auth.uid()) AND private.can_view_association(association_id));
