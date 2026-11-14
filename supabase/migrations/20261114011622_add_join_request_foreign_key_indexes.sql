-- Add covering indexes for foreign keys introduced by the unified join workflow.
-- Additive only: no rows are changed or removed.
create index if not exists association_public_links_created_by_user_id_idx
  on private.association_public_links (created_by_user_id);

create index if not exists join_requests_decided_by_user_id_idx
  on public.join_requests (decided_by_user_id);

create index if not exists join_requests_invitation_id_idx
  on public.join_requests (invitation_id);

create index if not exists join_requests_public_link_id_idx
  on public.join_requests (public_link_id);
