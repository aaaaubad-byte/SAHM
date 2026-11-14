-- Financial and operational RPC smoke test for SAHM.
-- Uses synthetic auth users and rolls back every row.
BEGIN;
INSERT INTO auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES('33333333-3333-4333-8333-333333333333','authenticated','authenticated',
 'sahm-ops-smoke-20261114@example.invalid','!',
 '{"provider":"email","providers":["email"]}'::jsonb,
 '{"terms_accepted":true,"terms_version":"2026-11-14"}'::jsonb,now(),now());

SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
 v_association uuid;
 v_membership uuid;
 v_cycle uuid;
 v_obligation uuid;
 v_receipt uuid;
 v_correction uuid;
 v_reminders integer;
 v_message uuid;
 v_draw jsonb;
BEGIN
 PERFORM public.complete_my_profile('مدير عمليات اختبار','+967777002111','avatar-01');

 v_association:=public.create_association_unified(jsonb_build_object(
  'name','جمعية اختبار العمليات المالية',
  'currency','YER',
  'startDate','2026-11-06',
  'firstDrawOn','2026-11-13',
  'timeZone','Asia/Aden',
  'shareAmountMinor',1000,
  'installmentMode','count',
  'installments',1,
  'managerParticipates',true,
  'managerShares',1,
  'quorum',50,
  'rules','اختبار معاملات مالية وتشغيلية مؤقتة'
 ));

 SELECT id INTO v_membership
 FROM public.association_memberships
 WHERE association_id=v_association AND user_id=auth.uid() AND status='active';

 SELECT id INTO v_cycle
 FROM public.association_cycles
 WHERE association_id=v_association AND cycle_no=1;

 SELECT id INTO v_obligation
 FROM public.installment_obligations
 WHERE association_id=v_association AND membership_id=v_membership;

 IF v_membership IS NULL OR v_cycle IS NULL OR v_obligation IS NULL THEN
  RAISE EXCEPTION 'Fixture creation failed for membership/cycle/obligation';
 END IF;

 v_receipt:=public.record_installment_receipt(v_obligation);

 BEGIN
  PERFORM public.record_installment_receipt(v_obligation);
  RAISE EXCEPTION 'Duplicate active receipt unexpectedly succeeded';
 EXCEPTION WHEN unique_violation THEN
  NULL;
 END;

 v_correction:=public.correct_installment_receipt(v_receipt,'تصحيح اختبار مالي');
 IF NOT EXISTS(
  SELECT 1 FROM public.receipt_corrections
  WHERE id=v_correction AND receipt_id=v_receipt
 ) THEN
  RAISE EXCEPTION 'Receipt correction audit record was not written';
 END IF;

 v_reminders:=public.send_installment_reminders(v_cycle,1,NULL);
 IF v_reminders<>1 THEN
  RAISE EXCEPTION 'Expected one reminder after receipt correction, got %',v_reminders;
 END IF;

 PERFORM public.set_cycle_attendance(v_cycle,v_membership,true);

 v_message:=public.send_chat_message(v_association,'رسالة اختبار تشغيل');
 IF NOT EXISTS(
  SELECT 1 FROM public.chat_messages
  WHERE id=v_message AND body='رسالة اختبار تشغيل'
 ) THEN
  RAISE EXCEPTION 'Chat message was not persisted';
 END IF;

 v_draw:=public.perform_draw(v_association,1);
 IF v_draw->>'round'<>'1' OR (v_draw->>'eligible_count')::integer<>1 THEN
  RAISE EXCEPTION 'Unexpected draw result: %',v_draw;
 END IF;

 IF NOT EXISTS(
  SELECT 1 FROM public.draw_eligible_shares
  WHERE draw_id=(v_draw->>'draw_id')::uuid
 ) THEN
  RAISE EXCEPTION 'Draw eligibility snapshot missing';
 END IF;

 BEGIN
  PERFORM public.perform_draw(v_association,1);
  RAISE EXCEPTION 'Duplicate draw unexpectedly succeeded';
 EXCEPTION WHEN serialization_failure THEN
  NULL;
 END;

 IF NOT EXISTS(
  SELECT 1 FROM public.associations
  WHERE id=v_association AND locked_at IS NOT NULL
 ) THEN
  RAISE EXCEPTION 'First draw did not lock association';
 END IF;
END;
$$;

ROLLBACK;
SELECT 'SAHM financial and operational RPC smoke test passed (transaction rolled back)' AS result;
