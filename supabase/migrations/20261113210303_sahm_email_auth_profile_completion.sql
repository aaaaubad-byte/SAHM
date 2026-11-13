-- SAHM email/password registration and lightweight profile onboarding.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_key text NOT NULL DEFAULT 'avatar-01',
  ADD COLUMN IF NOT EXISTS profile_completed boolean NOT NULL DEFAULT false;
ALTER TABLE public.profile_private ALTER COLUMN phone_e164 DROP NOT NULL;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_avatar_key_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_avatar_key_check CHECK (
 avatar_key=ANY(ARRAY['avatar-01','avatar-02','avatar-03','avatar-04','avatar-05','avatar-06',
 'avatar-07','avatar-08','avatar-09','avatar-10','avatar-11','avatar-12'])
);
CREATE TABLE IF NOT EXISTS public.legal_acceptances (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 terms_version text NOT NULL,
 accepted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,terms_version)
);
ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legal_acceptances FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.legal_acceptances TO authenticated;
DROP POLICY IF EXISTS legal_acceptances_select_own ON public.legal_acceptances;
CREATE POLICY legal_acceptances_select_own ON public.legal_acceptances
 FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));

CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_name text; v_phone text; v_city text; v_avatar text; v_terms boolean; v_terms_version text;
BEGIN
 v_name:=nullif(btrim(new.raw_user_meta_data->>'full_name'),'');
 IF v_name IS NULL OR length(v_name)<2 THEN v_name:='مستخدم سهم'; END IF;
 v_phone:=NULL;
 IF nullif(btrim(new.raw_user_meta_data->>'phone'),'') IS NOT NULL THEN
   v_phone:=private.normalize_phone_e164(new.raw_user_meta_data->>'phone');
 END IF;
 v_city:=nullif(btrim(new.raw_user_meta_data->>'city'),'');
 v_avatar:=coalesce(nullif(new.raw_user_meta_data->>'avatar_key',''),'avatar-01');
 IF v_avatar NOT IN ('avatar-01','avatar-02','avatar-03','avatar-04','avatar-05','avatar-06',
                     'avatar-07','avatar-08','avatar-09','avatar-10','avatar-11','avatar-12') THEN
   v_avatar:='avatar-01';
 END IF;
 INSERT INTO public.profiles(id,full_name,avatar_key,profile_completed)
 VALUES(new.id,v_name,v_avatar,false) ON CONFLICT(id) DO NOTHING;
 INSERT INTO public.profile_private(user_id,phone_e164,city)
 VALUES(new.id,v_phone,v_city) ON CONFLICT(user_id) DO NOTHING;
 INSERT INTO public.user_preferences(user_id) VALUES(new.id) ON CONFLICT(user_id) DO NOTHING;
 v_terms:=coalesce((new.raw_user_meta_data->>'terms_accepted')::boolean,false);
 v_terms_version:=nullif(new.raw_user_meta_data->>'terms_version','');
 IF v_terms AND v_terms_version IS NOT NULL THEN
   INSERT INTO public.legal_acceptances(user_id,terms_version)
   VALUES(new.id,v_terms_version) ON CONFLICT(user_id,terms_version) DO NOTHING;
 END IF;
 RETURN new;
END;
$function$;

CREATE OR REPLACE FUNCTION private.complete_my_profile(p_full_name text,p_phone_e164 text,p_avatar_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_phone text; v_parts text[]; v_avatar text;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً' USING ERRCODE='28000'; END IF;
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
CREATE OR REPLACE FUNCTION public.complete_my_profile(p_full_name text,p_phone_e164 text,p_avatar_key text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path TO ''
AS $function$ SELECT private.complete_my_profile(p_full_name,p_phone_e164,p_avatar_key); $function$;
REVOKE ALL ON FUNCTION private.complete_my_profile(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.complete_my_profile(text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.complete_my_profile(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_my_profile(text,text,text) TO authenticated;
