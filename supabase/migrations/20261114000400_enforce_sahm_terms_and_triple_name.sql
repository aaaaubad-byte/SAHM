
CREATE OR REPLACE FUNCTION private.complete_my_profile(p_full_name text,p_phone_e164 text,p_avatar_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
 v_uid uuid:=auth.uid(); v_phone text; v_parts text[]; v_avatar text;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً' USING ERRCODE='28000'; END IF;
 IF NOT EXISTS(
   SELECT 1 FROM public.legal_acceptances
   WHERE user_id=v_uid AND terms_version='2026-11-14'
 ) THEN RAISE EXCEPTION 'يجب الموافقة على الشروط والأحكام قبل إكمال الحساب' USING ERRCODE='42501'; END IF;
 IF p_full_name IS NULL OR length(btrim(p_full_name)) NOT BETWEEN 5 AND 120 THEN
   RAISE EXCEPTION 'أدخل الاسم الكامل من ثلاثة مقاطع على الأقل' USING ERRCODE='22023';
 END IF;
 v_parts:=regexp_split_to_array(btrim(p_full_name),'[[:space:]]+');
 IF coalesce(array_length(v_parts,1),0)<3 THEN
   RAISE EXCEPTION 'الاسم الكامل يجب أن يتكون من ثلاثة مقاطع على الأقل' USING ERRCODE='22023';
 END IF;
 v_phone:=private.normalize_phone_e164(p_phone_e164);
 v_avatar:=coalesce(nullif(p_avatar_key,''),'avatar-01');
 IF v_avatar NOT IN ('avatar-01','avatar-02','avatar-03','avatar-04','avatar-05','avatar-06',
                     'avatar-07','avatar-08','avatar-09','avatar-10','avatar-11','avatar-12') THEN
   RAISE EXCEPTION 'رمز صورة الحساب غير صالح' USING ERRCODE='22023';
 END IF;
 UPDATE public.profiles SET full_name=btrim(p_full_name),avatar_key=v_avatar,
   profile_completed=true,updated_at=now() WHERE id=v_uid;
 IF NOT FOUND THEN RAISE EXCEPTION 'ملف الحساب غير موجود' USING ERRCODE='P0002'; END IF;
 INSERT INTO public.profile_private(user_id,phone_e164,updated_at)
 VALUES(v_uid,v_phone,now())
 ON CONFLICT(user_id) DO UPDATE SET phone_e164=EXCLUDED.phone_e164,updated_at=now();
 RETURN jsonb_build_object('ok',true,'profile_completed',true);
EXCEPTION WHEN unique_violation THEN
 RAISE EXCEPTION 'رقم الهاتف مسجل مسبقاً بحساب آخر' USING ERRCODE='23505';
END;
$function$;

CREATE OR REPLACE FUNCTION private.update_my_profile(p_full_name text,p_city text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_parts text[];
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
 IF p_full_name IS NULL OR length(btrim(p_full_name)) NOT BETWEEN 5 AND 120 THEN
   RAISE EXCEPTION 'الاسم الكامل غير صالح' USING ERRCODE='22023';
 END IF;
 v_parts:=regexp_split_to_array(btrim(p_full_name),'[[:space:]]+');
 IF coalesce(array_length(v_parts,1),0)<3 THEN
   RAISE EXCEPTION 'الاسم الكامل يجب أن يتكون من ثلاثة مقاطع على الأقل' USING ERRCODE='22023';
 END IF;
 UPDATE public.profiles SET full_name=btrim(p_full_name),updated_at=now() WHERE id=v_uid;
 UPDATE public.profile_private SET city=nullif(btrim(coalesce(p_city,'')),''),updated_at=now()
 WHERE user_id=v_uid;
 RETURN true;
END;
$function$;
GRANT EXECUTE ON FUNCTION private.complete_my_profile(text,text,text),
 private.update_my_profile(text,text) TO authenticated;
