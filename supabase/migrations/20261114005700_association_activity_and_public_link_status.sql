-- Deliver in-app notifications for new invitations and join requests without exposing account discovery.
CREATE OR REPLACE FUNCTION private.notify_new_join_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_manager uuid;
BEGIN
  SELECT manager_user_id INTO v_manager FROM public.associations WHERE id=NEW.association_id;
  IF v_manager IS NOT NULL THEN
    INSERT INTO public.notifications(user_id,association_id,type,title,body,related_entity_id,idempotency_key)
    VALUES(v_manager,NEW.association_id,'join_request','طلب انضمام جديد',
      'قدّم '||coalesce(NEW.applicant_name,'مشارك')||' طلبًا للانضمام إلى الجمعية ويحتاج إلى مراجعتك',
      NEW.id,'join-request:'||NEW.id::text||':submitted')
    ON CONFLICT(idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.notify_new_join_request() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS join_requests_notify_manager ON public.join_requests;
CREATE TRIGGER join_requests_notify_manager AFTER INSERT ON public.join_requests
FOR EACH ROW EXECUTE FUNCTION private.notify_new_join_request();

CREATE OR REPLACE FUNCTION private.notify_invited_account()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_user uuid;
BEGIN
  IF NEW.invitee_phone_e164 IS NULL THEN RETURN NEW; END IF;
  SELECT pp.user_id INTO v_user FROM public.profile_private pp
  WHERE pp.phone_e164=NEW.invitee_phone_e164 LIMIT 1;
  IF v_user IS NOT NULL THEN
    INSERT INTO public.notifications(user_id,association_id,type,title,body,related_entity_id,idempotency_key)
    VALUES(v_user,NEW.association_id,'invitation','دعوة للانضمام إلى جمعية',
      'لديك دعوة جديدة في سهم. افتح قسم الدعوات لمراجعتها.',
      NEW.id,'invitation:'||NEW.id::text||':'||v_user::text)
    ON CONFLICT(idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.notify_invited_account() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS invitations_notify_invitee ON public.invitations;
CREATE TRIGGER invitations_notify_invitee AFTER INSERT ON public.invitations
FOR EACH ROW WHEN (NEW.shares_requested IS NULL)
EXECUTE FUNCTION private.notify_invited_account();

CREATE OR REPLACE FUNCTION private.get_association_public_link_status(p_association_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.associations WHERE id=p_association_id AND manager_user_id=v_uid) THEN
    RAISE EXCEPTION 'لا تملك صلاحية إدارة الرابط' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object('id',l.id,'status',l.status,'createdAt',l.created_at,'expiresAt',l.expires_at,'pausedAt',l.paused_at)
  INTO v_result FROM private.association_public_links l WHERE l.association_id=p_association_id
  ORDER BY l.created_at DESC LIMIT 1;
  RETURN coalesce(v_result,jsonb_build_object('status','none'));
END;
$function$;
REVOKE ALL ON FUNCTION private.get_association_public_link_status(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.get_association_public_link_status(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.get_association_public_link_status(p_association_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $function$ SELECT private.get_association_public_link_status(p_association_id); $function$;
REVOKE ALL ON FUNCTION public.get_association_public_link_status(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_association_public_link_status(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.list_my_invitations()
RETURNS SETOF public.invitations LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $function$
SELECT i.* FROM public.invitations i
LEFT JOIN public.profile_private pp ON pp.user_id=(SELECT auth.uid())
WHERE (i.invited_user_id=(SELECT auth.uid()) OR (i.invitee_phone_e164 IS NOT NULL AND i.invitee_phone_e164=pp.phone_e164))
  AND i.status='pending' AND i.response_status IN ('pending_response','interested','deferred')
  AND (i.expires_at IS NULL OR i.expires_at>now())
ORDER BY i.created_at DESC;
$function$;
REVOKE ALL ON FUNCTION private.list_my_invitations() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.list_my_invitations() TO authenticated;

CREATE OR REPLACE FUNCTION private.manage_association_public_link(p_association_id uuid,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
  v_uid uuid:=auth.uid(); v_a public.associations%ROWTYPE; v_link_id uuid;
  v_token text; v_status text; v_local_date date;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
  SELECT * INTO v_a FROM public.associations WHERE id=p_association_id AND manager_user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الجمعية غير موجودة أو لا تملك صلاحية إدارتها' USING ERRCODE='42501'; END IF;
  v_local_date:=(now() AT TIME ZONE v_a.time_zone)::date;
  IF p_action IN ('create','rotate','resume') AND
    (v_a.status<>'active' OR v_a.locked_at IS NOT NULL OR v_local_date>=v_a.start_date) THEN
    RAISE EXCEPTION 'لا يمكن تشغيل رابط الانضمام بعد إغلاق استقبال الأعضاء' USING ERRCODE='23514';
  END IF;
  IF p_action IN ('create','rotate') THEN
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

DO $publication$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='join_requests') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.join_requests;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='invitations') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.invitations;
  END IF;
END;
$publication$;
