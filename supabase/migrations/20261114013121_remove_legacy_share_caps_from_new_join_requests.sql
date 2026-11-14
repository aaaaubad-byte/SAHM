-- New join requests must not inherit historical association/member share caps.
-- Preserve old columns and values; remove only the trigger applying those legacy
-- values to the new join-request workflow.
DROP TRIGGER IF EXISTS join_requests_guard_legacy_limits_insert ON public.join_requests;
DROP TRIGGER IF EXISTS join_requests_guard_legacy_limits_approval ON public.join_requests;
DROP FUNCTION IF EXISTS private.guard_join_request_legacy_share_limits();
