-- End-to-end SAHM database business workflow. All test records are rolled back.
BEGIN;
INSERT INTO auth.users(
 id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','authenticated','authenticated',
  'sahm-manager-rollback@example.invalid','!',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"terms_accepted":true,"terms_version":"2026-11-14"}'::jsonb,now(),now()),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','authenticated','authenticated',
  'sahm-member-rollback@example.invalid','!',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"terms_accepted":true,"terms_version":"2026-11-14"}'::jsonb,now(),now());

SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
 v_association uuid;
 v_first_invite jsonb;
 v_second_invite jsonb;
 v_preview jsonb;
 v_accept jsonb;
 v_membership uuid;
 v_added integer;
 v_removed integer;
BEGIN
 PERFORM public.complete_my_profile('عبدالله محمد صالح','+967777000001','avatar-01');

 v_association:=public.create_association(jsonb_build_object(
   'name','جمعية اختبار تكامل مؤقتة',
   'currency','YER',
   'startDate','2026-12-01',
   'tz','Asia/Aden',
   'cycleType','weekly',
   'shareAmountMinor',100,
   'installments',1,
   'targetShares',10,
   'maxPerMember',3,
   'managerParticipates',false,
   'managerShares',0,
   'quorum',66,
   'rules','اختبار متراجع بالكامل'
 ));

 v_first_invite:=public.create_invitation(v_association,'أحمد محمد علي','+967777000002');
 IF v_first_invite->>'token' IS NULL THEN RAISE EXCEPTION 'Invitation token was not returned'; END IF;
 IF (SELECT shares_requested IS NOT NULL FROM public.invitations WHERE id=(v_first_invite->>'id')::uuid) THEN
   RAISE EXCEPTION 'New invitation unexpectedly assigned shares';
 END IF;

 PERFORM set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
 PERFORM public.complete_my_profile('أحمد محمد علي','+967777000002','avatar-02');

 v_preview:=public.preview_invitation(v_first_invite->>'token');
 IF v_preview->>'name'<>'جمعية اختبار تكامل مؤقتة' OR v_preview->>'managerName'<>'عبدالله محمد صالح' THEN
   RAISE EXCEPTION 'Invitation preview returned unexpected association data';
 END IF;

 PERFORM public.respond_to_invitation((v_first_invite->>'id')::uuid,'interested');
 v_accept:=public.submit_join_request('invitation',v_first_invite->>'token',1);
 IF v_accept->>'status'<>'pending' OR (v_accept->>'requested_shares')::integer<>1 THEN
   RAISE EXCEPTION 'Invitation did not create a pending join request';
 END IF;

 PERFORM set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
 v_accept:=public.approve_join_request((v_accept->>'request_id')::uuid);
 v_membership:=(v_accept->>'membership_id')::uuid;
 IF (v_accept->>'shares_added')::integer<>1 THEN RAISE EXCEPTION 'Approval did not add the requested share'; END IF;

 v_added:=public.add_shares(v_membership,1);
 IF v_added<>1 THEN RAISE EXCEPTION 'add_shares failed'; END IF;
 v_removed:=public.remove_shares(v_membership,1);
 IF v_removed<>1 THEN RAISE EXCEPTION 'remove_shares failed'; END IF;

 PERFORM public.remove_member(v_membership);
 IF EXISTS(SELECT 1 FROM public.association_memberships WHERE id=v_membership AND status='active') THEN
   RAISE EXCEPTION 'remove_member did not deactivate membership';
 END IF;

 -- A departed membership must not be reactivated indirectly by add_shares.
 BEGIN
   PERFORM public.add_shares(v_membership,1);
   RAISE EXCEPTION 'add_shares unexpectedly allowed a departed membership';
 EXCEPTION WHEN check_violation THEN
   NULL;
 END;
 IF EXISTS(SELECT 1 FROM public.shares WHERE membership_id=v_membership AND status='active') THEN
   RAISE EXCEPTION 'add_shares created active shares for a departed membership';
 END IF;

 PERFORM public.update_association(v_association,jsonb_build_object('name','جمعية اختبار معدلة'));
 v_second_invite:=public.create_invitation(v_association,'فاطمة علي محمد','+967777000003');
 IF NOT public.cancel_invitation((v_second_invite->>'id')::uuid) THEN
   RAISE EXCEPTION 'cancel_invitation did not cancel the pending invitation';
 END IF;

 IF NOT EXISTS(SELECT 1 FROM public.associations WHERE id=v_association AND name='جمعية اختبار معدلة') THEN
   RAISE EXCEPTION 'update_association did not persist the updated name';
 END IF;
END;
$$;
ROLLBACK;
SELECT 'SAHM association invite/member/share workflow passed (transaction rolled back)' AS result;
