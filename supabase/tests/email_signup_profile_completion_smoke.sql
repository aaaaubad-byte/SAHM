-- SAHM email signup and profile completion smoke tests.
-- Run with a privileged SQL editor role. Every test transaction is rolled back.
BEGIN;
INSERT INTO auth.users(
  id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES(
  '7e5d3b66-8660-4a2c-9c0f-fbfcc43ca14e','authenticated','authenticated',
  'sahm-rollback-test-20261114@example.invalid','!',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"terms_accepted":true,"terms_version":"2026-11-14"}'::jsonb,
  now(),now()
);
DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles
    WHERE id='7e5d3b66-8660-4a2c-9c0f-fbfcc43ca14e'
      AND profile_completed=false AND avatar_key='avatar-01') THEN
    RAISE EXCEPTION 'New Auth users must receive an incomplete default profile';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profile_private
    WHERE user_id='7e5d3b66-8660-4a2c-9c0f-fbfcc43ca14e' AND phone_e164 IS NULL) THEN
    RAISE EXCEPTION 'Phone must remain nullable until profile onboarding';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.legal_acceptances
    WHERE user_id='7e5d3b66-8660-4a2c-9c0f-fbfcc43ca14e'
      AND terms_version='2026-11-14') THEN
    RAISE EXCEPTION 'Terms acceptance must be recorded at signup';
  END IF;
END;
$$;
ROLLBACK;

BEGIN;
INSERT INTO auth.users(
  id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES(
  '7e5d3b66-8660-4a2c-9c0f-fbfcc43ca14e','authenticated','authenticated',
  'sahm-rollback-test-20261114@example.invalid','!',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"terms_accepted":true,"terms_version":"2026-11-14"}'::jsonb,
  now(),now()
);
SELECT set_config('request.jwt.claim.sub','7e5d3b66-8660-4a2c-9c0f-fbfcc43ca14e',true);
SET LOCAL ROLE authenticated;
SELECT public.complete_my_profile('أحمد محمد علي','+967777123456','avatar-03');
DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles
    WHERE id=auth.uid() AND profile_completed=true
      AND full_name='أحمد محمد علي' AND avatar_key='avatar-03') THEN
    RAISE EXCEPTION 'Authenticated profile RPC failed to persist full name/avatar';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profile_private
    WHERE user_id=auth.uid() AND phone_e164='+967777123456') THEN
    RAISE EXCEPTION 'Authenticated profile RPC failed to persist the E.164 phone';
  END IF;
END;
$$;
ROLLBACK;

BEGIN;
INSERT INTO auth.users(
  id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES(
  'd24168a4-5c5a-49b8-9e82-8a4b0504b1d1','authenticated','authenticated',
  'sahm-no-terms-rollback@example.invalid','!',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),now()
);
SELECT set_config('request.jwt.claim.sub','d24168a4-5c5a-49b8-9e82-8a4b0504b1d1',true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.complete_my_profile('أحمد محمد علي','+967777123457','avatar-01');
    RAISE EXCEPTION 'Profile completion unexpectedly succeeded without accepted terms';
  EXCEPTION WHEN insufficient_privilege THEN
    IF position('الشروط والأحكام' in SQLERRM)=0 THEN RAISE; END IF;
  END;
END;
$$;
ROLLBACK;

SELECT 'SAHM signup/profile smoke tests passed (all test users rolled back)' AS result;
