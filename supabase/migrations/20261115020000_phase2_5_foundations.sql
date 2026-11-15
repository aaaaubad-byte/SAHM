-- SAHM phases 2-5 database batch, part 1/5: foundations.
-- Additive only: no table or column is dropped. Internal helpers are not executable by API roles.

-- ---------------------------------------------------------------------
-- Phase 3 schema: scheduled draw time and presentation status 'failed'
-- ---------------------------------------------------------------------
alter table public.association_cycles add column if not exists draw_scheduled_at timestamptz;

alter table public.association_cycles drop constraint if exists association_cycles_status_check;
alter table public.association_cycles add constraint association_cycles_status_check
  check (status = any (array['scheduled'::text,'open'::text,'drawn'::text,'completed'::text,'failed'::text]));

-- ---------------------------------------------------------------------
-- Phase 4 schema: independent feed / chat channels and name visibility
-- enabled_types is kept for backward compatibility.
-- ---------------------------------------------------------------------
alter table public.association_notification_settings
  add column if not exists feed_enabled_types text[] not null
    default array['received','completed','late','drawSoon','drawDue','drawResult','joined','motivate']::text[],
  add column if not exists chat_enabled_types text[] not null
    default array['received','completed','late','drawSoon','drawDue','drawResult','joined','motivate']::text[],
  add column if not exists name_visible_types text[] not null
    default array['drawResult']::text[];

update public.association_notification_settings
   set feed_enabled_types = enabled_types,
       chat_enabled_types = enabled_types;

alter table public.association_notification_settings
  add constraint ans_feed_types_valid check (feed_enabled_types <@ array['received','completed','late','drawSoon','drawDue','drawResult','joined','motivate']::text[]),
  add constraint ans_chat_types_valid check (chat_enabled_types <@ array['received','completed','late','drawSoon','drawDue','drawResult','joined','motivate']::text[]),
  add constraint ans_name_types_valid check (name_visible_types <@ array['received','completed','late','drawSoon','drawDue','drawResult','joined','motivate']::text[]);

-- ---------------------------------------------------------------------
-- Phase 5 schema: run log for the time-event job (private, no API access)
-- ---------------------------------------------------------------------
create table if not exists private.time_event_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  summary jsonb,
  error text
);
alter table private.time_event_runs enable row level security;
revoke all on table private.time_event_runs from public, anon, authenticated, service_role;
revoke all on sequence private.time_event_runs_id_seq from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Unified event publisher (Phase 4)
-- 1) inserts the original event (audit record)
-- 2) fans out individual notifications according to feed_enabled_types
-- 3) inserts a system chat message only if the type is in chat_enabled_types
-- Names are never copied into notification text; they are resolved at read
-- time by get_association_news according to name_visible_types.
-- ---------------------------------------------------------------------
create or replace function private.publish_association_event(
  p_association_id uuid,
  p_actor_user_id uuid,
  p_event_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_visibility text,
  p_before jsonb,
  p_after jsonb,
  p_feed_type text default null,
  p_subject_user_id uuid default null,
  p_feed_title text default null,
  p_feed_body text default null,
  p_chat_body text default null,
  p_public jsonb default '{}'::jsonb,
  p_exclude_user_ids uuid[] default '{}'::uuid[]
) returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_allowed constant text[] := array['received','completed','late','drawSoon','drawDue','drawResult','joined','motivate'];
  v_feed text[];
  v_chat text[];
  v_event uuid;
  v_after jsonb := coalesce(p_after, '{}'::jsonb);
begin
  if p_feed_type is not null and not (p_feed_type = any(v_allowed)) then
    raise exception 'نوع خبر غير معروف' using errcode = '22023';
  end if;

  if p_feed_type is not null then
    v_after := v_after || jsonb_build_object('_feed', jsonb_build_object(
      'type', p_feed_type,
      'subject_user_id', p_subject_user_id,
      'title', p_feed_title,
      'body', p_feed_body,
      'public', coalesce(p_public, '{}'::jsonb)
    ));
  end if;

  insert into public.association_events(
    association_id, actor_user_id, event_type, entity_type, entity_id, visibility, before_data, after_data
  ) values (
    p_association_id, p_actor_user_id, p_event_type, p_entity_type, p_entity_id, p_visibility, p_before, v_after
  ) returning id into v_event;

  if p_feed_type is not null then
    select s.feed_enabled_types, s.chat_enabled_types into v_feed, v_chat
    from public.association_notification_settings s
    where s.association_id = p_association_id;
    if not found then
      v_feed := v_allowed;
      v_chat := v_allowed;
    end if;

    if p_feed_type = any(v_feed) then
      insert into public.notifications(user_id, association_id, type, title, body, related_entity_id, idempotency_key)
      select r.user_id, p_association_id, p_feed_type,
             coalesce(p_feed_title, 'خبر جديد'), coalesce(p_feed_body, 'خبر جديد في الجمعية'),
             coalesce(p_entity_id, v_event),
             'ev:' || v_event::text || ':' || r.user_id::text || ':feed'
      from (
        select m.user_id from public.association_memberships m
        where m.association_id = p_association_id and m.status = 'active'
        union
        select a.manager_user_id from public.associations a where a.id = p_association_id
      ) r
      left join public.user_preferences up on up.user_id = r.user_id
      where coalesce(up.notifications_enabled, true)
        and not (r.user_id = any(coalesce(p_exclude_user_ids, '{}'::uuid[])))
      on conflict (idempotency_key) do nothing;
    end if;

    if p_chat_body is not null and p_feed_type = any(v_chat) then
      insert into public.chat_messages(association_id, kind, body, system_type, event_id)
      values (p_association_id, 'system', p_chat_body, p_feed_type, v_event);
    end if;
  end if;

  return v_event;
end;
$function$;

revoke all on function private.publish_association_event(uuid,uuid,text,text,uuid,text,jsonb,jsonb,text,uuid,text,text,text,jsonb,uuid[])
  from public, anon, authenticated, service_role;

-- Raw events are an audit record: managers only. Members read the sanitized feed
-- through get_association_news (names hidden on the server per name_visible_types).
drop policy if exists events_select on public.association_events;
create policy events_select on public.association_events
  for select to authenticated
  using (private.is_association_manager(association_id));

-- ---------------------------------------------------------------------
-- Derived installment status (no duplicated status column)
-- upcoming: period not started; due: inside the period; late: period ended unpaid; paid: active receipt
-- ---------------------------------------------------------------------
create or replace function private.derive_installment_status(p_paid boolean, p_starts date, p_ends date, p_today date)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case
    when p_paid then 'paid'
    when p_today < p_starts then 'upcoming'
    when p_today <= p_ends then 'due'
    else 'late'
  end;
$function$;

revoke all on function private.derive_installment_status(boolean,date,date,date) from public, anon, service_role;
grant execute on function private.derive_installment_status(boolean,date,date,date) to authenticated;

create or replace view public.installment_obligation_status
with (security_invoker = true) as
select o.id as obligation_id, o.association_id, o.cycle_id, o.membership_id, o.period_id,
       c.cycle_no, p.installment_no, p.starts_on, p.ends_on,
       o.shares_count, o.amount_minor, o.currency,
       r.id as receipt_id, r.recorded_at as paid_at,
       private.derive_installment_status(r.id is not null, p.starts_on, p.ends_on,
         (now() at time zone a.time_zone)::date) as status
from public.installment_obligations o
join public.installment_periods p on p.id = o.period_id
join public.association_cycles c on c.id = o.cycle_id
join public.associations a on a.id = o.association_id
left join public.installment_receipts r on r.obligation_id = o.id and r.status = 'active';

revoke all on public.installment_obligation_status from public, anon, service_role;
grant select on public.installment_obligation_status to authenticated;

-- ---------------------------------------------------------------------
-- Draw readiness (Phase 2). Internal computation, shared by perform_draw,
-- get_draw_readiness and the time-event job.
-- Scope: cumulative (all cycles up to the target cycle, so old arrears are never hidden)
-- or the target cycle only. One aggregated obligation per member per period; every
-- active member with active shares must have a matching obligation and a matching
-- active receipt, otherwise the draw is not ready.
-- ---------------------------------------------------------------------
create or replace function private.compute_draw_readiness(p_association_id uuid, p_cycle_id uuid, p_cycle_only boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_cycle public.association_cycles%rowtype;
  v_scope uuid[];
  v_periods_expected integer;
  v_periods_found integer;
  v_orphans integer;
  v_reasons text[] := array[]::text[];
  r record;
begin
  select * into v_cycle from public.association_cycles
  where id = p_cycle_id and association_id = p_association_id;
  if not found then
    return jsonb_build_object('ready', false, 'reasons', jsonb_build_array('دورة القرعة غير مهيأة'));
  end if;

  select array_agg(c.id) into v_scope
  from public.association_cycles c
  where c.association_id = p_association_id
    and (case when p_cycle_only then c.cycle_no = v_cycle.cycle_no else c.cycle_no <= v_cycle.cycle_no end);

  select coalesce(sum(c.installments_count), 0)::integer into v_periods_expected
  from public.association_cycles c where c.id = any(v_scope);
  select count(*)::integer into v_periods_found
  from public.installment_periods p
  where p.association_id = p_association_id and p.cycle_id = any(v_scope);

  with mem as (
    select m.id as membership_id, count(s.id)::integer as shares
    from public.association_memberships m
    join public.shares s on s.membership_id = m.id and s.association_id = m.association_id and s.status = 'active'
    where m.association_id = p_association_id and m.status = 'active'
    group by m.id
  ), per as (
    select p.id as period_id, p.cycle_id, p.per_share_amount_minor
    from public.installment_periods p
    where p.association_id = p_association_id and p.cycle_id = any(v_scope)
  ), ex as (
    select mem.membership_id, mem.shares, per.period_id, per.per_share_amount_minor * mem.shares as exp_amount
    from mem cross join per
  ), j as (
    select ex.membership_id, ex.shares, ex.period_id, ex.exp_amount,
      case
        when o.id is null then 'missing'
        when o.shares_count <> ex.shares or o.amount_minor <> ex.exp_amount then 'mismatch'
        when rc.id is null then 'unpaid'
        when rc.amount_minor <> o.amount_minor then 'receipt_mismatch'
        else 'paid'
      end as st
    from ex
    left join public.installment_obligations o on o.membership_id = ex.membership_id and o.period_id = ex.period_id
    left join public.installment_receipts rc on rc.obligation_id = o.id and rc.status = 'active'
  )
  select
    (select count(*) from mem)::integer as members_total,
    (select coalesce(sum(shares), 0) from mem)::integer as shares_total,
    count(*)::integer as obligations_expected,
    (count(*) filter (where st <> 'missing'))::integer as obligations_found,
    (count(*) filter (where st = 'missing'))::integer as n_missing,
    (count(*) filter (where st = 'mismatch'))::integer as n_mismatch,
    (count(*) filter (where st = 'receipt_mismatch'))::integer as n_rcpt,
    (count(*) filter (where st = 'unpaid'))::integer as n_unpaid,
    (count(*) filter (where st = 'paid'))::integer as n_paid,
    coalesce(sum(exp_amount), 0)::bigint as due_minor,
    coalesce(sum(exp_amount) filter (where st = 'paid'), 0)::bigint as collected_minor,
    (count(distinct period_id) filter (where st <> 'paid'))::integer as periods_open,
    (count(distinct membership_id) filter (where st <> 'paid'))::integer as members_incomplete,
    (select coalesce(sum(x.shares), 0) from (select distinct membership_id, shares from j where st <> 'paid') x)::integer as shares_incomplete
  into r
  from j;

  select count(*)::integer into v_orphans
  from public.installment_obligations o
  where o.association_id = p_association_id and o.cycle_id = any(v_scope)
    and not exists (
      select 1 from public.association_memberships m
      join public.shares s on s.membership_id = m.id and s.status = 'active'
      where m.id = o.membership_id and m.status = 'active'
    );

  if r.members_total = 0 or r.shares_total = 0 then
    v_reasons := array_append(v_reasons, 'لا توجد أسهم نشطة مؤهلة للدورة'::text);
  end if;
  if v_periods_found <> v_periods_expected then
    v_reasons := array_append(v_reasons, format('فترات الأقساط غير مكتملة (%s من %s)', v_periods_found, v_periods_expected));
  end if;
  if r.n_missing > 0 then
    v_reasons := array_append(v_reasons, format('التزامات ناقصة: %s', r.n_missing));
  end if;
  if r.n_mismatch > 0 then
    v_reasons := array_append(v_reasons, format('التزامات لا تطابق عدد الأسهم أو قيمة القسط: %s', r.n_mismatch));
  end if;
  if v_orphans > 0 then
    v_reasons := array_append(v_reasons, format('التزامات لا تتبع عضوية نشطة: %s', v_orphans));
  end if;
  if r.n_rcpt > 0 then
    v_reasons := array_append(v_reasons, format('إيصالات لا تطابق مبلغ الالتزام: %s', r.n_rcpt));
  end if;
  if r.n_unpaid > 0 then
    v_reasons := array_append(v_reasons, format('أقساط غير مسددة: %s التزام، المتبقي %s', r.n_unpaid, r.due_minor - r.collected_minor));
  end if;

  return jsonb_build_object(
    'ready', coalesce(array_length(v_reasons, 1), 0) = 0,
    'cycle_id', v_cycle.id,
    'cycle_no', v_cycle.cycle_no,
    'scope', case when p_cycle_only then 'cycle' else 'cumulative' end,
    'periods_expected', v_periods_expected,
    'periods_found', v_periods_found,
    'members_total', r.members_total,
    'shares_total', r.shares_total,
    'obligations_expected', r.obligations_expected,
    'obligations_found', r.obligations_found,
    'obligations_missing', r.n_missing,
    'obligations_mismatched', r.n_mismatch,
    'receipts_mismatched', r.n_rcpt,
    'orphan_obligations', v_orphans,
    'obligations_paid', r.n_paid,
    'obligations_unpaid', r.n_unpaid,
    'members_complete', r.members_total - r.members_incomplete,
    'members_incomplete', r.members_incomplete,
    'shares_complete', r.shares_total - r.shares_incomplete,
    'shares_incomplete', r.shares_incomplete,
    'installments_remaining', r.periods_open,
    'due_minor', r.due_minor,
    'collected_minor', r.collected_minor,
    'remaining_minor', r.due_minor - r.collected_minor,
    'reasons', to_jsonb(v_reasons)
  );
end;
$function$;

revoke all on function private.compute_draw_readiness(uuid,uuid,boolean) from public, anon, authenticated, service_role;

-- Manager-facing readiness (same diagnostics, nothing is executed or changed)
create or replace function private.get_draw_readiness(p_association_id uuid)
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
  v_fin jsonb;
  v_date_ok boolean;
  v_time_ok boolean;
  v_open boolean;
begin
  if v_uid is null then raise exception 'يجب تسجيل الدخول' using errcode = '28000'; end if;
  select * into v_a from public.associations where id = p_association_id and manager_user_id = v_uid;
  if not found then raise exception 'جاهزية القرعة متاحة لمدير الجمعية فقط' using errcode = '42501'; end if;

  select count(*) + 1 into v_round from public.draws where association_id = p_association_id;
  select * into v_cycle from public.association_cycles
  where association_id = p_association_id and cycle_no = v_round;
  if not found then
    return jsonb_build_object('financial_ready', false, 'can_draw', false, 'round_no', v_round,
      'reasons', jsonb_build_array('دورة القرعة غير مهيأة'));
  end if;

  v_fin := private.compute_draw_readiness(p_association_id, v_cycle.id, false);
  v_date_ok := (now() at time zone v_a.time_zone)::date >= v_cycle.ends_on + 1;
  v_time_ok := v_cycle.draw_scheduled_at is null or now() >= v_cycle.draw_scheduled_at;
  v_open := v_cycle.status in ('scheduled', 'open') and v_a.status = 'active';

  return (v_fin - 'ready') || jsonb_build_object(
    'financial_ready', coalesce((v_fin->>'ready')::boolean, false),
    'date_reached', v_date_ok,
    'time_reached', v_time_ok,
    'can_draw', coalesce((v_fin->>'ready')::boolean, false) and v_date_ok and v_time_ok and v_open,
    'round_no', v_round,
    'due_on', v_cycle.ends_on + 1,
    'draw_scheduled_at', v_cycle.draw_scheduled_at,
    'cycle_status', v_cycle.status
  );
end;
$function$;

revoke all on function private.get_draw_readiness(uuid) from public, anon, service_role;
grant execute on function private.get_draw_readiness(uuid) to authenticated;

create or replace function public.get_draw_readiness(p_association_id uuid)
returns jsonb
language sql
set search_path to ''
as $function$ select private.get_draw_readiness(p_association_id); $function$;

revoke all on function public.get_draw_readiness(uuid) from public, anon, service_role;
grant execute on function public.get_draw_readiness(uuid) to authenticated;
