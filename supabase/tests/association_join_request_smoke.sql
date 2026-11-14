-- SAHM association join-request business workflow.
-- All test users and domain rows are rolled back; this runs only on the isolated CI database.
BEGIN;

INSERT INTO auth.users(
 id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','authenticated','authenticated',
  'sahm-join-manager@example.invalid','!',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"terms_accepted":true,"terms_version":"2026-11-14"}'::jsonb,now(),now()),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','authenticated','authenticated',
  'sahm-join-member@example.invalid','!',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"terms_accepted":true,"terms_version":"2026-11-14"}'::jsonb,now(),now()),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','authenticated','authenticated',
  'sahm-join-retry@example.invalid','!',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"terms_accepted":true,"terms_version":"2026-11-14"}'::jsonb,now(),now()),
 ('ffffffff-ffff-4fff-8fff-ffffffffffff','authenticated','authenticated',
  'sahm-public-join@example.invalid','!',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"terms_accepted":true,"terms_version":"2026-11-14"}'::jsonb,now(),now());

SELECT set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
 v_association uuid;
 v_invitation jsonb;
 v_invitation_retry jsonb;
 v_member_response jsonb;
 v_member_request jsonb;
 v_approved jsonb;
 v_rejected_request jsonb;
 v_resubmitted jsonb;
 v_public_link jsonb;
 v_public_preview jsonb;
 v_public_request jsonb;
 v_manager_membership uuid;
 v_member_membership uuid;
 v_request_id uuid;
 v_retry_request_id uuid;
 v_created_shares integer;
 v_created_obligations integer;
BEGIN
 PERFORM public.complete_my_profile('مدير اختبار صالح','+967777000101','avatar-01');

 v_association:=public.create_association_unified(jsonb_build_object(
   'name','جمعية اختبار طلبات الانضمام',
   'currency','YER',
   'startDate','2026-12-01',
   'firstDrawOn','2026-12-31',
   'timeZone','Asia/Aden',
   'shareAmountMinor',9000,
   'installmentMode','count',
   'installments',3,
   'managerParticipates',true,
   'managerShares',1,
   'quorum',50,
   'rules','اختبار آلي معزول'
 ));

 SELECT id INTO v_manager_membership
 FROM public.association_memberships
 WHERE association_id=v_association AND user_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' AND status='active';
 IF v_manager_membership IS NULL THEN RAISE EXCEPTION 'Manager participation was not created'; END IF;

 v_invitation:=public.create_invitation(v_association,'عضو اختبار','+967777000102');
 IF v_invitation->>'token' IS NULL THEN RAISE EXCEPTION 'Invitation token was not returned'; END IF;
 IF (SELECT shares_requested IS NOT NULL FROM public.invitations WHERE id=(v_invitation->>'id')::uuid) THEN
   RAISE EXCEPTION 'New invitation unexpectedly assigned a share count';
 END IF;

 PERFORM set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',true);
 PERFORM public.complete_my_profile('عضو اختبار صالح','+967777000102','avatar-02');
 v_member_response:=public.respond_to_invitation((v_invitation->>'id')::uuid,'interested');
 IF v_member_response->>'response_status'<>'interested' THEN RAISE EXCEPTION 'Invitation response was not stored'; END IF;

 v_member_request:=public.submit_join_request('invitation',v_invitation->>'token',2);
 v_request_id:=(v_member_request->>'request_id')::uuid;
 IF v_member_request->>'status'<>'pending' OR (v_member_request->>'requested_shares')::integer<>2 THEN
   RAISE EXCEPTION 'Join request payload was not stored correctly';
 END IF;
 IF (v_member_request->>'estimated_amount_minor')::bigint<>18000 THEN
   RAISE EXCEPTION 'Server-side commitment estimate is incorrect';
 END IF;
 PERFORM set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
 IF EXISTS(SELECT 1 FROM public.association_memberships WHERE association_id=v_association AND user_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd') THEN
   RAISE EXCEPTION 'Submitting a join request created a membership before manager approval';
 END IF;
 IF EXISTS(SELECT 1 FROM public.shares WHERE association_id=v_association AND membership_id IN
   (SELECT id FROM public.association_memberships WHERE association_id=v_association AND user_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd')) THEN
   RAISE EXCEPTION 'Submitting a join request created shares before manager approval';
 END IF;

 PERFORM set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',true);
 BEGIN
   PERFORM public.submit_join_request('invitation',v_invitation->>'token',2);
   RAISE EXCEPTION 'Duplicate pending request unexpectedly succeeded';
 EXCEPTION WHEN unique_violation THEN
   NULL;
 END;

 PERFORM set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
 v_approved:=public.approve_join_request(v_request_id);
 IF v_approved->>'status'<>'approved' OR (v_approved->>'shares_added')::integer<>2 THEN
   RAISE EXCEPTION 'Manager approval did not approve the full requested share count';
 END IF;
 v_member_membership:=(v_approved->>'membership_id')::uuid;
 SELECT count(*) INTO v_created_shares FROM public.shares
 WHERE association_id=v_association AND membership_id=v_member_membership AND status='active';
 SELECT count(*) INTO v_created_obligations FROM public.installment_obligations
 WHERE association_id=v_association AND membership_id=v_member_membership;
 IF v_created_shares<>2 THEN RAISE EXCEPTION 'Approval created % shares instead of 2',v_created_shares; END IF;
 IF v_created_obligations<>3 THEN RAISE EXCEPTION 'Approval created % obligations instead of 3',v_created_obligations; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.join_requests WHERE id=v_request_id AND status='approved' AND membership_id=v_member_membership) THEN
   RAISE EXCEPTION 'Approved request does not reference its membership';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.invitations WHERE id=(v_invitation->>'id')::uuid AND status='accepted') THEN
   RAISE EXCEPTION 'Invitation was not finalized after approval';
 END IF;

 BEGIN
   PERFORM public.approve_join_request(v_request_id);
   RAISE EXCEPTION 'Duplicate approval unexpectedly succeeded';
 EXCEPTION WHEN check_violation THEN
   NULL;
 END;

 -- A rejected request remains a separate attempt; the original invitation may be reused.
 v_invitation_retry:=public.create_invitation(v_association,'مقدم طلب آخر','+967777000103');
 PERFORM set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',true);
 PERFORM public.complete_my_profile('مقدم طلب صالح','+967777000103','avatar-03');
 PERFORM public.respond_to_invitation((v_invitation_retry->>'id')::uuid,'interested');
 v_rejected_request:=public.submit_join_request('invitation',v_invitation_retry->>'token',1);
 v_retry_request_id:=(v_rejected_request->>'request_id')::uuid;

 PERFORM set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
 PERFORM public.reject_join_request(v_retry_request_id,'اختبار رفض آلي');
 IF NOT EXISTS(SELECT 1 FROM public.join_requests WHERE id=v_retry_request_id AND status='rejected') THEN
   RAISE EXCEPTION 'Rejected request status was not persisted';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.invitations WHERE id=(v_invitation_retry->>'id')::uuid AND status='pending' AND response_status='interested') THEN
   RAISE EXCEPTION 'Rejecting a join request incorrectly invalidated its invitation';
 END IF;

 PERFORM set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',true);
 v_resubmitted:=public.submit_join_request('invitation',v_invitation_retry->>'token',1);
 IF (v_resubmitted->>'request_id')::uuid=v_retry_request_id THEN
   RAISE EXCEPTION 'Resubmission reused the previous request identity';
 END IF;
 PERFORM public.cancel_join_request((v_resubmitted->>'request_id')::uuid);

 PERFORM set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
 BEGIN
   PERFORM public.approve_join_request((v_resubmitted->>'request_id')::uuid);
   RAISE EXCEPTION 'Cancelled request unexpectedly approved';
 EXCEPTION WHEN check_violation THEN
   NULL;
 END;
 IF NOT EXISTS(SELECT 1 FROM public.join_requests WHERE id=(v_resubmitted->>'request_id')::uuid AND status='cancelled') THEN
   RAISE EXCEPTION 'Cancelled request status was not persisted';
 END IF;
 IF EXISTS(SELECT 1 FROM public.association_memberships WHERE association_id=v_association AND user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') THEN
   RAISE EXCEPTION 'Rejected/resubmitted/cancelled requests created a membership';
 END IF;

 -- The public link uses the same request model but has no personal invitation.
 PERFORM set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
 v_public_link:=public.manage_association_public_link(v_association,'create');
 IF v_public_link->>'token' IS NULL THEN RAISE EXCEPTION 'Public join link token was not returned'; END IF;

 PERFORM set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',true);
 PERFORM public.complete_my_profile('عضو رابط عام صالح','+967777000104','avatar-04');
 v_public_preview:=public.preview_public_join_link(v_public_link->>'token');
 IF v_public_preview->>'name'<>'جمعية اختبار طلبات الانضمام' THEN
   RAISE EXCEPTION 'Public-link preview returned unexpected association data';
 END IF;
 v_public_request:=public.submit_join_request('public_link',v_public_link->>'token',1);
 IF v_public_request->>'status'<>'pending' THEN RAISE EXCEPTION 'Public link did not create a pending request'; END IF;

 PERFORM set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
 PERFORM public.manage_association_public_link(v_association,'pause');
 PERFORM set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',true);
 BEGIN
   PERFORM public.submit_join_request('public_link',v_public_link->>'token',1);
   RAISE EXCEPTION 'Paused public link unexpectedly accepted a new request';
 EXCEPTION WHEN SQLSTATE '22023' THEN
   NULL;
 END;

 PERFORM set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
 PERFORM public.manage_association_public_link(v_association,'resume');
 v_approved:=public.approve_join_request((v_public_request->>'request_id')::uuid);
 IF v_approved->>'status'<>'approved' OR (v_approved->>'shares_added')::integer<>1 THEN
   RAISE EXCEPTION 'Manager approval did not finalize the public-link request';
 END IF;
 IF EXISTS(SELECT 1 FROM public.association_memberships WHERE association_id=v_association
   AND user_id='ffffffff-ffff-4fff-8fff-ffffffffffff' AND status<>'active') THEN
   RAISE EXCEPTION 'Public-link approval created a non-active membership';
 END IF;
END;
$$;

ROLLBACK;
SELECT 'SAHM invitation -> join request -> manager approval/rejection workflow passed (transaction rolled back)' AS result;
