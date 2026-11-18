-- Return only the authenticated participant's own active shares.
-- SECURITY INVOKER preserves the existing association RLS policies.
create or replace function public.get_my_association_shares(p_association_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_membership_id uuid;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'يجب تسجيل الدخول' using errcode = '28000';
  end if;

  select m.id into v_membership_id
  from public.association_memberships m
  where m.association_id = p_association_id
    and m.user_id = v_uid
    and m.status = 'active';

  if not found then
    raise exception 'لا توجد عضوية نشطة في هذه الجمعية' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'share_id', s.id,
    'share_no', s.share_no,
    'status', case when w.round_no is null then 'eligible' else 'won' end,
    'winner_round', w.round_no
  ) order by s.share_no), '[]'::jsonb)
  into v_result
  from public.shares s
  left join lateral (
    select d.round_no
    from public.draws d
    where d.association_id = s.association_id
      and d.winner_share_id = s.id
    order by d.round_no
    limit 1
  ) w on true
  where s.association_id = p_association_id
    and s.membership_id = v_membership_id
    and s.status = 'active';

  return v_result;
end;
$function$;

revoke all on function public.get_my_association_shares(uuid) from public, anon, service_role;
grant execute on function public.get_my_association_shares(uuid) to authenticated;
