-- Manager-scoped read-only share register. SECURITY INVOKER keeps table RLS in force.
create or replace function public.get_association_shares(p_association_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'يجب تسجيل الدخول' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.associations a
    where a.id = p_association_id and a.manager_user_id = v_uid
  ) then
    raise exception 'قائمة الأسهم متاحة لمدير الجمعية فقط' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'share_id', s.id,
    'share_no', s.share_no,
    'membership_id', m.id,
    'user_id', m.user_id,
    'owner_name', p.full_name,
    'status', case when w.round_no is null then 'eligible' else 'won' end,
    'winner_round', w.round_no
  ) order by s.share_no), '[]'::jsonb)
  into v_result
  from public.shares s
  join public.association_memberships m
    on m.id = s.membership_id and m.association_id = s.association_id
  join public.profiles p on p.id = m.user_id
  left join lateral (
    select d.round_no
    from public.draws d
    where d.winner_share_id = s.id and d.association_id = s.association_id
    order by d.round_no
    limit 1
  ) w on true
  where s.association_id = p_association_id
    and s.status = 'active'
    and m.status = 'active';

  return v_result;
end;
$function$;

revoke all on function public.get_association_shares(uuid) from public, anon, service_role;
grant execute on function public.get_association_shares(uuid) to authenticated;
