
ALTER TABLE public.profile_private
  DROP CONSTRAINT IF EXISTS profile_private_phone_e164_check;
ALTER TABLE public.profile_private
  ADD CONSTRAINT profile_private_phone_e164_check
  CHECK (phone_e164 IS NULL OR phone_e164 ~ '^[+][1-9][0-9]{7,14}$');
