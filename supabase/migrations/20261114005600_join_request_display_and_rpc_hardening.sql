-- Display a safe applicant-name snapshot on request rows without broadening profile visibility.
ALTER TABLE public.join_requests ADD COLUMN applicant_name text;

UPDATE public.join_requests r
SET applicant_name = coalesce(nullif(btrim(p.full_name),''),'مشارك')
FROM public.profiles p
WHERE p.id = r.applicant_user_id AND r.applicant_name IS NULL;

UPDATE public.join_requests SET applicant_name='مشارك' WHERE applicant_name IS NULL;
ALTER TABLE public.join_requests ALTER COLUMN applicant_name SET NOT NULL;

CREATE OR REPLACE FUNCTION private.set_join_request_applicant_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.applicant_name IS NULL OR btrim(NEW.applicant_name)='' THEN
    SELECT coalesce(nullif(btrim(p.full_name),''),'مشارك')
    INTO NEW.applicant_name
    FROM public.profiles p
    WHERE p.id=NEW.applicant_user_id;

    IF NEW.applicant_name IS NULL THEN
      RAISE EXCEPTION 'ملف مقدم الطلب غير موجود' USING ERRCODE='23503';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.set_join_request_applicant_name() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS join_requests_set_applicant_name ON public.join_requests;
CREATE TRIGGER join_requests_set_applicant_name
BEFORE INSERT ON public.join_requests
FOR EACH ROW EXECUTE FUNCTION private.set_join_request_applicant_name();

-- The helper returns an entire association row and is only an internal guard used by SECURITY DEFINER RPCs.
REVOKE ALL ON FUNCTION private.assert_association_join_open(uuid) FROM PUBLIC,anon,authenticated;
