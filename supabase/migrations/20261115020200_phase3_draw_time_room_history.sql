-- SAHM phases 2-5 database batch, part 3/5: draw time, presentation status, draw room and history.
-- draws and draw_eligible_shares stay append-only; nothing here can create or change a result.

-- ---------------------------------------------------------------------
-- Manager sets the exact draw time, on the due day only.
-- ---------------------------------------------------------------------
create or replace function private.set_draw_scheduled_at(p_association_id uuid, p_scheduled_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_a public.associations%rowtype;
  v_round integer;
  v_cycle public.association_cycles%rowtype;
  v_due date;
  v_old timestamptz;
begin
  if v_uid is null then raise exception 'يجب تسجيل الدخول' using errcode = '28000'; end if;
  if p_scheduled_at is null then raise exception 'وقت القرعة مطلوب' using errcode = '22023'; end if;

  select * into v_a from public.associations
  where id = p_association_id and manager_user_id = v_uid and status = 'active'
  for update;
  if not found then raise exception 'تحديد وقت القرعة متاح لمدير الجمعية فقط' using errcode = '42501'; end if;

  select count(*) + 1 into v_round from public.draws where association_id = p_association_id;
  select * into v_cycle from public.association_cycles
  where association_id = p_association_id and cycle_no = v_round
  for update;
  if not found then raise exception 'دورة القرعة غير مهيأة' using errcode = '23514'; end if;
  if v_cycle.status not in ('scheduled', 'open') then
    raise exception 'نتيجة هذه الدورة مثبتة مسبقًا' using errcode = '23514';
  end if;

  v_due := v_cycle.ends_on + 1;
  if (now() at time zone v_a.time_zone)::date <> v_due then
    raise exception 'يُحدد وقت القرعة في يوم الاستحقاق فقط' using errcode = '22023';
  end if;
  if (p_scheduled_at at time zone v_a.time_zone)::date <> v_due then
    raise exception 'يجب أن يقع وقت القرعة داخل يوم الاستحقاق' using errcode = '22023';
  end if;
  if p_scheduled_at < now() then
    raise exception 'لا يمكن تحديد وقت في الماضي' using errcode = '22023';
  end if;

  v_old := v_cycle.draw_scheduled_at;
  update public.association_cycles set draw_scheduled_at = p_scheduled_at where id = v_cycle.id;

  perform private.publish_association_event(
    p_association_id := p_association_id, p_actor_user_id := v_uid,
    p_event_type := 'draw_scheduled', p_entity_type := 'cycle', p_entity_id := v_cycle.id,
    p_visibility := 'all',
    p_before := jsonb_build_object('draw_scheduled_at', v_old),
    p_after := jsonb_build_object('draw_scheduled_at', p_scheduled_at, 'round', v_round),
    p_feed_type := 'drawSoon', p_subject_user_id := null,
    p_feed_title := 'تحديد موعد القرعة', p_feed_body := 'تم تحديد وقت قرعة الجمعية',
    p_chat_body := 'تم تحديد وقت القرعة',
    p_public := jsonb_build_object('round', v_round, 'draw_scheduled_at', p_scheduled_at)
  );

  return jsonb_build_object('cycle_id', v_cycle.id, 'round_no', v_round, 'draw_scheduled_at', p_scheduled_at);
end;
$function$;

-- ---------------------------------------------------------------------
-- Presentation status only: drawn -> completed | failed, failed -> completed | failed.
-- Never touches draws or the winner.
-- ---------------------------------------------------------------------
create or replace function private.set_draw_presentation_status(p_association_id uuid, p_round_no integer, p_status text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_cycle public.association_cycles%rowtype;
begin
  if v_uid is null then raise exception 'يجب تسجيل الدخول' using errcode = '28000'; end if;
  if p_status is null or p_status not in ('completed', 'failed') then
    raise exception 'حالة العرض غير صالحة' using errcode = '22023';
  end if;
  if not private.is_association_manager(p_association_id) then
    raise exception 'تحديث حالة العرض متاح لمدير الجمعية فقط' using errcode = '42501';
  end if;

  select * into v_cycle from public.association_cycles
  where association_id = p_association_id and cycle_no = p_round_no
  for update;
  if not found then raise exception 'الجولة غير موجودة' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.draws where cycle_id = v_cycle.id) then
    raise exception 'لم تثبت نتيجة هذه الجولة بعد' using errcode = '23514';
  end if;

  if v_cycle.status = p_status then
    return jsonb_build_object('round_no', p_round_no, 'status', v_cycle.status, 'changed', false);
  end if;
  if v_cycle.status = 'completed' then
    raise exception 'اكتمل عرض هذه القرعة مسبقًا' using errcode = '23514';
  end if;
  if v_cycle.status not in ('drawn', 'failed') then
    raise exception 'حالة الدورة لا تسمح بهذا التحديث' using errcode = '23514';
  end if;

  update public.association_cycles set status = p_status where id = v_cycle.id;

  perform private.publish_association_event(
    p_association_id := p_association_id, p_actor_user_id := v_uid,
    p_event_type := 'draw_presentation_' || p_status, p_entity_type := 'cycle', p_entity_id := v_cycle.id,
    p_visibility := 'manager',
    p_before := jsonb_build_object('status', v_cycle.status),
    p_after := jsonb_build_object('status', p_status, 'round', p_round_no)
  );

  return jsonb_build_object('round_no', p_round_no, 'status', p_status, 'changed', true);
end;
$function$;

-- ---------------------------------------------------------------------
-- Draw room: readable by any active member or the manager.
-- Before the draw: current candidates (shares that have not won). After: the saved
-- eligible snapshot, the recorded winner and its index in that snapshot (ordered by
-- share number so every device lays out the wheel identically).
-- ---------------------------------------------------------------------
create or replace function private.get_draw_room(p_association_id uuid, p_round_no integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_a public.associations%rowtype;
  v_round integer;
  v_cycle public.association_cycles%rowtype;
  v_draw public.draws%rowtype;
  v_has_draw boolean;
  v_eligible jsonb;
  v_winner jsonb;
  v_index integer;
  v_state text;
  v_rounds_total integer;
  v_is_manager boolean;
begin
  if v_uid is null then raise exception 'يجب تسجيل الدخول' using errcode = '28000'; end if;
  select * into v_a from public.associations where id = p_association_id;
  v_is_manager := private.is_association_manager(p_association_id);
  if not found or not (v_is_manager or private.is_association_member(p_association_id)) then
    raise exception 'غرفة القرعة متاحة لأعضاء الجمعية ومديرها فقط' using errcode = '42501';
  end if;

  select count(*) into v_rounds_total from public.association_cycles where association_id = p_association_id;
  v_round := coalesce(p_round_no, (select count(*) + 1 from public.draws where association_id = p_association_id));

  select * into v_cycle from public.association_cycles
  where association_id = p_association_id and cycle_no = v_round;
  if not found then
    return jsonb_build_object(
      'association_id', p_association_id, 'round_no', v_round, 'rounds_total', v_rounds_total,
      'state', 'none', 'is_manager', v_is_manager, 'eligible_shares', '[]'::jsonb, 'draw', null);
  end if;

  select * into v_draw from public.draws where association_id = p_association_id and cycle_id = v_cycle.id;
  v_has_draw := found;

  if v_has_draw then
    select coalesce(jsonb_agg(jsonb_build_object(
        'share_id', s.id, 'share_no', s.share_no, 'membership_id', m.id,
        'owner_user_id', m.user_id, 'owner_name', pr.full_name, 'avatar_key', pr.avatar_key
      ) order by s.share_no), '[]'::jsonb)
    into v_eligible
    from public.draw_eligible_shares d
    join public.shares s on s.id = d.share_id
    join public.association_memberships m on m.id = s.membership_id
    join public.profiles pr on pr.id = m.user_id
    where d.draw_id = v_draw.id;

    select (t.ord - 1)::integer, t.e into v_index, v_winner
    from jsonb_array_elements(v_eligible) with ordinality as t(e, ord)
    where t.e->>'share_id' = v_draw.winner_share_id::text;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
        'share_id', s.id, 'share_no', s.share_no, 'membership_id', m.id,
        'owner_user_id', m.user_id, 'owner_name', pr.full_name, 'avatar_key', pr.avatar_key
      ) order by s.share_no), '[]'::jsonb)
    into v_eligible
    from public.shares s
    join public.association_memberships m on m.id = s.membership_id and m.status = 'active'
    join public.profiles pr on pr.id = m.user_id
    where s.association_id = p_association_id and s.status = 'active'
      and not exists (select 1 from public.draws d2 where d2.winner_share_id = s.id);
  end if;

  v_state := case
    when not v_has_draw then (case when v_cycle.status in ('scheduled', 'open') then 'pending' else v_cycle.status end)
    when v_cycle.status = 'completed' then 'completed'
    when v_cycle.status = 'failed' then 'failed'
    else 'presenting'
  end;

  return jsonb_build_object(
    'association_id', p_association_id,
    'association_name', v_a.name,
    'currency', v_a.currency,
    'round_no', v_round,
    'rounds_total', v_rounds_total,
    'state', v_state,
    'is_manager', v_is_manager,
    'cycle', jsonb_build_object(
      'id', v_cycle.id, 'cycle_no', v_cycle.cycle_no, 'status', v_cycle.status,
      'starts_on', v_cycle.starts_on, 'ends_on', v_cycle.ends_on, 'due_on', v_cycle.ends_on + 1,
      'draw_scheduled_at', v_cycle.draw_scheduled_at),
    'eligible_shares', v_eligible,
    'draw', case when v_has_draw then jsonb_build_object(
      'id', v_draw.id, 'round_no', v_draw.round_no, 'drawn_at', v_draw.drawn_at,
      'scheduled_on', v_draw.scheduled_on, 'eligible_count', v_draw.eligible_count,
      'share_count_at_draw', v_draw.share_count_at_draw, 'prize_target_minor', v_draw.prize_target_minor,
      'winner_share_id', v_draw.winner_share_id, 'winner_index', v_index,
      'winner_share_no', v_winner->>'share_no',
      'winner_owner_user_id', v_winner->>'owner_user_id',
      'winner_owner_name', v_winner->>'owner_name') else null end
  );
end;
$function$;

-- ---------------------------------------------------------------------
-- Draw history with share number, execution time, presentation status and result details.
-- (There is no draw_history object in the database; this is its server-side source.)
-- ---------------------------------------------------------------------
create or replace function private.get_draw_history(p_association_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then raise exception 'يجب تسجيل الدخول' using errcode = '28000'; end if;
  if not (private.is_association_manager(p_association_id) or private.is_association_member(p_association_id)) then
    raise exception 'سجل القرعات متاح لأعضاء الجمعية ومديرها فقط' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'round_no', d.round_no,
      'draw_id', d.id,
      'cycle_id', d.cycle_id,
      'scheduled_on', d.scheduled_on,
      'draw_scheduled_at', c.draw_scheduled_at,
      'drawn_at', d.drawn_at,
      'winner_share_id', d.winner_share_id,
      'winner_share_no', s.share_no,
      'winner_owner_user_id', m.user_id,
      'winner_owner_name', pr.full_name,
      'eligible_count', d.eligible_count,
      'share_count_at_draw', d.share_count_at_draw,
      'prize_target_minor', d.prize_target_minor,
      'currency', a.currency,
      'cycle_status', c.status,
      'presentation_status', case c.status when 'completed' then 'completed' when 'failed' then 'failed' else 'in_progress' end,
      'algorithm_version', d.algorithm_version
    ) order by d.round_no), '[]'::jsonb)
  into v_result
  from public.draws d
  join public.association_cycles c on c.id = d.cycle_id
  join public.associations a on a.id = d.association_id
  join public.shares s on s.id = d.winner_share_id
  join public.association_memberships m on m.id = s.membership_id
  join public.profiles pr on pr.id = m.user_id
  where d.association_id = p_association_id;

  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------
-- Grants and public wrappers (same pattern as existing RPCs)
-- ---------------------------------------------------------------------
revoke all on function private.set_draw_scheduled_at(uuid,timestamptz) from public, anon, service_role;
revoke all on function private.set_draw_presentation_status(uuid,integer,text) from public, anon, service_role;
revoke all on function private.get_draw_room(uuid,integer) from public, anon, service_role;
revoke all on function private.get_draw_history(uuid) from public, anon, service_role;
grant execute on function private.set_draw_scheduled_at(uuid,timestamptz) to authenticated;
grant execute on function private.set_draw_presentation_status(uuid,integer,text) to authenticated;
grant execute on function private.get_draw_room(uuid,integer) to authenticated;
grant execute on function private.get_draw_history(uuid) to authenticated;

create or replace function public.set_draw_scheduled_at(p_association_id uuid, p_scheduled_at timestamptz)
returns jsonb language sql set search_path to ''
as $function$ select private.set_draw_scheduled_at(p_association_id, p_scheduled_at); $function$;

create or replace function public.set_draw_presentation_status(p_association_id uuid, p_round_no integer, p_status text)
returns jsonb language sql set search_path to ''
as $function$ select private.set_draw_presentation_status(p_association_id, p_round_no, p_status); $function$;

create or replace function public.get_draw_room(p_association_id uuid, p_round_no integer default null)
returns jsonb language sql set search_path to ''
as $function$ select private.get_draw_room(p_association_id, p_round_no); $function$;

create or replace function public.get_draw_history(p_association_id uuid)
returns jsonb language sql set search_path to ''
as $function$ select private.get_draw_history(p_association_id); $function$;

revoke all on function public.set_draw_scheduled_at(uuid,timestamptz) from public, anon, service_role;
revoke all on function public.set_draw_presentation_status(uuid,integer,text) from public, anon, service_role;
revoke all on function public.get_draw_room(uuid,integer) from public, anon, service_role;
revoke all on function public.get_draw_history(uuid) from public, anon, service_role;
grant execute on function public.set_draw_scheduled_at(uuid,timestamptz) to authenticated;
grant execute on function public.set_draw_presentation_status(uuid,integer,text) to authenticated;
grant execute on function public.get_draw_room(uuid,integer) to authenticated;
grant execute on function public.get_draw_history(uuid) to authenticated;
