-- Merge the two permissive invitation SELECT policies without changing access.
DROP POLICY IF EXISTS invitations_invitee_select ON public.invitations;
DROP POLICY IF EXISTS invitations_manager_select ON public.invitations;

CREATE POLICY invitations_select_invitee_or_manager
ON public.invitations
FOR SELECT
TO authenticated
USING (
  invited_user_id = (SELECT auth.uid())
  OR invitee_phone_e164 = (
    SELECT pp.phone_e164
    FROM public.profile_private pp
    WHERE pp.user_id = (SELECT auth.uid())
  )
  OR private.is_association_manager(association_id)
);
