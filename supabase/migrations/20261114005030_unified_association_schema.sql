-- SAHM unified association workflow: additive production schema transition.
-- Existing association, invitation, membership, share and obligation rows are preserved.
-- No table or row is dropped by this migration.

ALTER TABLE public.associations
  ADD COLUMN IF NOT EXISTS first_draw_on date,
  ADD COLUMN IF NOT EXISTS installment_mode text NOT NULL DEFAULT 'count',
  ADD COLUMN IF NOT EXISTS installment_amount_minor bigint;

UPDATE public.associations
SET first_draw_on = start_date + cycle_days
WHERE first_draw_on IS NULL;

ALTER TABLE public.associations
  ALTER COLUMN first_draw_on SET NOT NULL,
  ALTER COLUMN target_shares DROP NOT NULL,
  ALTER COLUMN max_shares_per_member DROP NOT NULL;

ALTER TABLE public.associations
  ADD CONSTRAINT associations_installment_mode_check
    CHECK (installment_mode IN ('count','amount')),
  ADD CONSTRAINT associations_installment_amount_check
    CHECK (
      (installment_mode = 'count' AND installment_amount_minor IS NULL)
      OR (installment_mode = 'amount' AND installment_amount_minor > 0)
    );

ALTER TABLE public.association_cycles
  ADD COLUMN IF NOT EXISTS installment_mode text NOT NULL DEFAULT 'count',
  ADD COLUMN IF NOT EXISTS installment_amount_minor bigint;

ALTER TABLE public.association_cycles
  ADD CONSTRAINT association_cycles_installment_mode_check
    CHECK (installment_mode IN ('count','amount')),
  ADD CONSTRAINT association_cycles_installment_amount_check
    CHECK (
      (installment_mode = 'count' AND installment_amount_minor IS NULL)
      OR (installment_mode = 'amount' AND installment_amount_minor > 0)
    );

-- Old invitation rows retain their historical share count. New invitations may leave it NULL.
ALTER TABLE public.invitations
  ALTER COLUMN shares_requested DROP NOT NULL,
  ADD COLUMN response_status text NOT NULL DEFAULT 'pending_response',
  ADD COLUMN responded_at timestamptz;

UPDATE public.invitations
SET response_status = CASE
  WHEN status = 'accepted' THEN 'legacy_accepted'
  WHEN status = 'cancelled' THEN 'cancelled'
  WHEN status = 'expired' THEN 'expired'
  ELSE 'pending_response'
END;

ALTER TABLE public.invitations
  ADD CONSTRAINT invitations_response_status_check
  CHECK (response_status IN (
    'pending_response','interested','declined','deferred',
    'legacy_accepted','expired','cancelled'
  ));

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE private.association_public_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_id uuid NOT NULL REFERENCES public.associations(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','revoked','expired')),
  created_by_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  paused_at timestamptz,
  revoked_at timestamptz,
  rotated_at timestamptz
);

CREATE UNIQUE INDEX association_public_links_one_active_idx
  ON private.association_public_links(association_id)
  WHERE status = 'active';

CREATE INDEX association_public_links_association_history_idx
  ON private.association_public_links(association_id, created_at DESC);

REVOKE ALL ON TABLE private.association_public_links FROM PUBLIC, anon, authenticated;

CREATE TABLE public.join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_id uuid NOT NULL REFERENCES public.associations(id) ON DELETE RESTRICT,
  applicant_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  invitation_id uuid REFERENCES public.invitations(id) ON DELETE RESTRICT,
  public_link_id uuid REFERENCES private.association_public_links(id) ON DELETE RESTRICT,
  source_type text NOT NULL CHECK (source_type IN ('invitation','public_link')),
  requested_shares integer NOT NULL CHECK (requested_shares > 0),
  estimated_amount_minor bigint NOT NULL CHECK (estimated_amount_minor > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','cancelled')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by_user_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  rejection_reason text,
  membership_id uuid REFERENCES public.association_memberships(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT join_requests_source_shape_check CHECK (
    (source_type = 'invitation' AND invitation_id IS NOT NULL AND public_link_id IS NULL)
    OR
    (source_type = 'public_link' AND public_link_id IS NOT NULL AND invitation_id IS NULL)
  ),
  CONSTRAINT join_requests_decision_shape_check CHECK (
    (status = 'pending' AND decided_at IS NULL AND decided_by_user_id IS NULL AND membership_id IS NULL)
    OR
    (status = 'approved' AND decided_at IS NOT NULL AND decided_by_user_id IS NOT NULL AND membership_id IS NOT NULL)
    OR
    (status IN ('rejected','cancelled') AND decided_at IS NOT NULL AND membership_id IS NULL)
  )
);

CREATE UNIQUE INDEX join_requests_one_pending_per_user_idx
  ON public.join_requests(association_id, applicant_user_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX join_requests_one_membership_idx
  ON public.join_requests(membership_id)
  WHERE membership_id IS NOT NULL;

CREATE INDEX join_requests_association_status_idx
  ON public.join_requests(association_id, status, submitted_at DESC);

CREATE INDEX join_requests_applicant_history_idx
  ON public.join_requests(applicant_user_id, submitted_at DESC);

ALTER TABLE public.join_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY join_requests_select_owner_or_manager
  ON public.join_requests
  FOR SELECT TO authenticated
  USING (
    applicant_user_id = (SELECT auth.uid())
    OR private.is_association_manager(association_id)
  );

REVOKE ALL ON TABLE public.join_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.join_requests TO authenticated;

CREATE OR REPLACE FUNCTION private.sync_association_first_draw()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.first_draw_on IS NULL THEN
      NEW.first_draw_on := NEW.start_date + NEW.cycle_days;
    END IF;
  ELSIF NEW.first_draw_on IS NOT DISTINCT FROM OLD.first_draw_on
    AND (NEW.start_date IS DISTINCT FROM OLD.start_date
      OR NEW.cycle_days IS DISTINCT FROM OLD.cycle_days) THEN
    NEW.first_draw_on := NEW.start_date + NEW.cycle_days;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.sync_association_first_draw() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS associations_sync_first_draw ON public.associations;
CREATE TRIGGER associations_sync_first_draw
BEFORE INSERT OR UPDATE OF start_date, cycle_days, first_draw_on
ON public.associations
FOR EACH ROW EXECUTE FUNCTION private.sync_association_first_draw();
