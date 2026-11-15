-- SAHM phases 2-5 database batch, part 2/5: draw eligibility, receipts, event publishing, attendance retirement.
-- Large live functions are changed by exact text patches (each must match exactly once, otherwise the whole migration fails).

create or replace function pg_temp.patch_fn(p_sig text, p_old text, p_new text) returns void
language plpgsql as $h$
declare
  v_def text;
  v_cnt integer;
begin
  v_def := pg_get_functiondef(p_sig::regprocedure);
  v_cnt := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  if v_cnt <> 1 then
    raise exception 'patch_fn: % matches (expected exactly 1) in %', v_cnt, p_sig;
  end if;
  execute replace(v_def, p_old, p_new);
end;
$h$;

-- ---------------------------------------------------------------------
-- perform_draw: no attendance, no quorum. Full financial readiness is enforced here,
-- inside PostgreSQL. Winner selection stays in pgcrypto (rejection sampling).
-- Paying shares (all active) and eligible shares (not yet won) are separate sets:
-- the prize and every obligation are computed on all active shares.
-- Later cycles are generated with the same last-installment rounding as creation.
-- ---------------------------------------------------------------------
create or replace function private.perform_draw(p_association_id uuid, p_expected_round_no integer)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_a public.associations%rowtype;
  v_cycle public.association_cycles%rowtype;
  v_round integer;
  v_total_shares integer;
  v_people integer;
  v_readiness jsonb;
  v_candidates uuid[];
  v_n integer;
  v_limit bigint;
  v_rand bigint;
  v_bytes bytea;
  v_index integer;
  v_winner uuid;
  v_winner_user uuid;
  v_winner_no integer;
  v_draw uuid;
  v_event uuid;
  v_cycle_no integer;
  v_installment_no integer;
  v_days_base integer;
  v_days_rem integer;
  v_amount_base bigint;
  v_amount_rem integer;
  v_amount_left bigint;
  v_period_days integer;
  v_period_amount bigint;
  v_cursor date;
  v_period uuid;
  v_member record;
  v_new_cycle uuid;
  v_cycle_start date;
begin
  if v_uid is null then raise exception 'يجب تسجيل الدخول' using errcode = '28000'; end if;
  if p_expected_round_no is null or p_expected_round_no < 1 then
    raise exception 'رقم الجولة غير صالح' using errcode = '22023';
  end if;

  select * into v_a
  from public.associations
  where id = p_association_id and manager_user_id = v_uid and status = 'active'
  for update;
  if not found then raise exception 'القرعة متاحة لمدير الجمعية فقط' using errcode = '42501'; end if;

  select count(*) + 1 into v_round from public.draws where association_id = p_association_id;
  if v_round <> p_expected_round_no then
    raise exception 'تم تحديث حالة القرعة؛ أعد تحميل الجولة الحالية' using errcode = '40001';
  end if;

  select * into v_cycle
  from public.association_cycles
  where association_id = p_association_id and cycle_no = v_round
  for update;
  if not found then raise exception 'دورة القرعة غير مهيأة' using errcode = '23514'; end if;

  if (now() at time zone v_a.time_zone)::date < v_cycle.ends_on + 1 then
    raise exception 'لم يحل موعد القرعة بعد' using errcode = '22023';
  end if;
  if v_cycle.draw_scheduled_at is not null and now() < v_cycle.draw_scheduled_at then
    raise exception 'لم يحل الوقت المحدد للقرعة بعد' using errcode = '22023';
  end if;

  select count(*) into v_total_shares
  from public.shares where association_id = p_association_id and status = 'active';
  select count(*) into v_people
  from public.association_memberships where association_id = p_association_id and status = 'active';
  if v_total_shares = 0 then raise exception 'لا توجد أسهم مؤهلة' using errcode = '23514'; end if;

  v_readiness := private.compute_draw_readiness(p_association_id, v_cycle.id, false);
  if not coalesce((v_readiness->>'ready')::boolean, false) then
    raise exception 'لا يمكن إجراء القرعة قبل اكتمال الأقساط: %',
      array_to_string(array(select jsonb_array_elements_text(v_readiness->'reasons')), '، ')
      using errcode = '23514', detail = v_readiness::text;
  end if;

  select array_agg(s.id order by s.id) into v_candidates
  from public.shares s
  where s.association_id = p_association_id and s.status = 'active'
    and not exists(select 1 from public.draws d where d.winner_share_id = s.id);
  v_n := coalesce(array_length(v_candidates, 1), 0);
  if v_n = 0 then raise exception 'لا توجد أسهم مؤهلة لهذه القرعة' using errcode = '23514'; end if;

  v_limit := floor(4294967296::numeric / v_n)::bigint * v_n;
  loop
    v_bytes := extensions.gen_random_bytes(4);
    v_rand := get_byte(v_bytes, 0)::bigint * 16777216
      + get_byte(v_bytes, 1)::bigint * 65536
      + get_byte(v_bytes, 2)::bigint * 256
      + get_byte(v_bytes, 3)::bigint;
    exit when v_rand < v_limit;
  end loop;
  v_index := (v_rand % v_n)::integer + 1;
  v_winner := v_candidates[v_index];

  insert into public.draws(
    association_id, cycle_id, round_no, scheduled_on, winner_share_id,
    share_count_at_draw, eligible_count, prize_target_minor, quorum_people,
    quorum_required, algorithm_version
  ) values (
    p_association_id, v_cycle.id, v_round, v_cycle.ends_on + 1, v_winner,
    v_total_shares, v_n, v_a.share_amount_minor * v_total_shares, v_people,
    0, 'pgcrypto-rejection-v1'
  ) returning id into v_draw;

  insert into public.draw_eligible_shares(association_id, draw_id, share_id)
  select p_association_id, v_draw, x from unnest(v_candidates) as x;
  update public.association_cycles set status = 'drawn' where id = v_cycle.id;

  if v_round = 1 then
    update public.associations
    set locked_at = now(), locked_share_count = v_total_shares
    where id = p_association_id and locked_at is null;

    for v_cycle_no in 2..v_total_shares loop
      v_cycle_start := v_a.start_date + (v_cycle_no - 1) * v_a.cycle_days;

      insert into public.association_cycles(
        association_id, cycle_no, starts_on, ends_on, duration_days, currency,
        share_amount_minor, installments_count, cycle_type,
        installment_mode, installment_amount_minor
      ) values (
        p_association_id, v_cycle_no, v_cycle_start,
        v_cycle_start + v_a.cycle_days - 1, v_a.cycle_days,
        v_a.currency, v_a.share_amount_minor, v_a.installments_count,
        v_a.cycle_type, v_a.installment_mode, v_a.installment_amount_minor
      ) returning id into v_new_cycle;

      v_days_base := v_a.cycle_days / v_a.installments_count;
      v_days_rem := v_a.cycle_days % v_a.installments_count;
      v_amount_base := case when v_a.installment_mode = 'count'
        then v_a.share_amount_minor / v_a.installments_count
        else v_a.installment_amount_minor end;
      v_amount_rem := case when v_a.installment_mode = 'count'
        then (v_a.share_amount_minor % v_a.installments_count)::integer else 0 end;
      v_amount_left := v_a.share_amount_minor;
      v_cursor := v_cycle_start;

      for v_installment_no in 1..v_a.installments_count loop
        v_period_days := v_days_base + case when v_installment_no <= v_days_rem then 1 else 0 end;
        if v_a.installment_mode = 'count' then
          -- the last installment absorbs the whole rounding difference
          v_period_amount := v_amount_base + case when v_installment_no = v_a.installments_count then v_amount_rem else 0 end;
        else
          v_period_amount := least(v_a.installment_amount_minor, v_amount_left);
          v_amount_left := v_amount_left - v_period_amount;
        end if;

        insert into public.installment_periods(
          association_id, cycle_id, installment_no, starts_on, ends_on, per_share_amount_minor
        ) values (
          p_association_id, v_new_cycle, v_installment_no, v_cursor,
          v_cursor + v_period_days - 1, v_period_amount
        ) returning id into v_period;

        for v_member in
          select m.id, count(s.id)::integer as shares_count
          from public.association_memberships m
          join public.shares s on s.membership_id = m.id and s.status = 'active'
          where m.association_id = p_association_id and m.status = 'active'
          group by m.id
        loop
          insert into public.installment_obligations(
            association_id, cycle_id, membership_id, period_id, shares_count, amount_minor, currency
          ) values (
            p_association_id, v_new_cycle, v_member.id, v_period, v_member.shares_count,
            v_period_amount * v_member.shares_count, v_a.currency
          );
        end loop;

        v_cursor := v_cursor + v_period_days;
      end loop;
    end loop;
  end if;

  select m.user_id, s.share_no into v_winner_user, v_winner_no
  from public.shares s join public.association_memberships m on m.id = s.membership_id
  where s.id = v_winner;

  v_event := private.publish_association_event(
    p_association_id := p_association_id, p_actor_user_id := v_uid,
    p_event_type := 'draw_result', p_entity_type := 'draw', p_entity_id := v_draw,
    p_visibility := 'all', p_before := null,
    p_after := jsonb_build_object(
      'round', v_round, 'winner_share_id', v_winner,
      'eligible_count', v_n, 'prize_target_minor', v_a.share_amount_minor * v_total_shares),
    p_feed_type := 'drawResult', p_subject_user_id := v_winner_user,
    p_feed_title := 'نتيجة القرعة', p_feed_body := 'تم تثبيت نتيجة قرعة الجمعية',
    p_chat_body := 'تم تثبيت نتيجة القرعة',
    p_public := jsonb_build_object(
      'round', v_round, 'winner_share_no', v_winner_no,
      'eligible_count', v_n, 'prize_target_minor', v_a.share_amount_minor * v_total_shares)
  );

  return jsonb_build_object(
    'draw_id', v_draw, 'round', v_round, 'winner_share_id', v_winner,
    'eligible_count', v_n, 'locked', (v_round = 1), 'event_id', v_event
  );
end;
$function$;

-- ---------------------------------------------------------------------
-- record_installment_receipt: same behavior, but the member-facing news goes through
-- the unified publisher. The beneficiary keeps an independent personal confirmation.
-- ---------------------------------------------------------------------
create or replace function private.record_installment_receipt(p_obligation_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_o public.installment_obligations%rowtype;
  v_a public.associations%rowtype;
  v_receipt uuid;
  v_beneficiary uuid;
begin
  if v_uid is null then raise exception 'يجب تسجيل الدخول' using errcode = '28000'; end if;
  select * into v_o from public.installment_obligations where id = p_obligation_id for update;
  if not found then raise exception 'الالتزام غير موجود' using errcode = 'P0002'; end if;
  select * into v_a from public.associations where id = v_o.association_id and manager_user_id = v_uid for update;
  if not found then raise exception 'تسجيل الاستلام متاح لمدير الجمعية فقط' using errcode = '42501'; end if;
  select user_id into v_beneficiary from public.association_memberships where id = v_o.membership_id;
  if v_beneficiary is null then raise exception 'عضوية المستفيد غير موجودة' using errcode = '23503'; end if;

  insert into public.installment_receipts(
    association_id, obligation_id, membership_id, beneficiary_user_id, recorded_by_user_id,
    amount_minor, currency, self_recorded
  ) values (
    v_o.association_id, v_o.id, v_o.membership_id, v_beneficiary, v_uid,
    v_o.amount_minor, v_o.currency, (v_beneficiary = v_uid)
  ) returning id into v_receipt;

  perform private.publish_association_event(
    p_association_id := v_o.association_id, p_actor_user_id := v_uid,
    p_event_type := 'installment_received', p_entity_type := 'receipt', p_entity_id := v_receipt,
    p_visibility := 'all', p_before := null,
    p_after := jsonb_build_object(
      'obligation_id', v_o.id, 'amount_minor', v_o.amount_minor, 'currency', v_o.currency,
      'self_recorded', (v_beneficiary = v_uid)),
    p_feed_type := 'received', p_subject_user_id := v_beneficiary,
    p_feed_title := 'تسجيل استلام قسط', p_feed_body := 'تم تسجيل استلام قسط لأحد المشاركين',
    p_chat_body := 'تم تسجيل استلام قسط لأحد المشاركين',
    p_public := '{}'::jsonb, p_exclude_user_ids := array[v_beneficiary, v_uid]
  );

  -- personal, necessary confirmation to the obligation owner (independent of feed settings)
  insert into public.notifications(user_id, association_id, type, title, body, related_entity_id, idempotency_key)
  values (v_beneficiary, v_o.association_id, 'received', 'تسجيل استلام قسط',
          'سجّل مدير الجمعية استلام القسط المستحق', v_receipt,
          'receipt:' || v_receipt::text || ':' || v_beneficiary::text)
  on conflict (idempotency_key) do nothing;

  return v_receipt;
end;
$function$;

-- ---------------------------------------------------------------------
-- Join paths publish the "joined" news through the unified publisher
-- ---------------------------------------------------------------------
select pg_temp.patch_fn('private.accept_invitation(text)',
$o1$  INSERT INTO public.association_events(
    association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data
  ) VALUES (
    v_assoc.id,v_uid,'member_joined','membership',v_membership,'all',
    jsonb_build_object('shares',v_inv.shares_requested,'legacy_invitation',true)
  ) RETURNING id INTO v_event;

  IF EXISTS(
    SELECT 1 FROM public.association_notification_settings s
    WHERE s.association_id = v_assoc.id AND 'joined' = ANY(s.enabled_types)
  ) THEN
    INSERT INTO public.chat_messages(association_id,kind,body,system_type,event_id)
    VALUES(v_assoc.id,'system','انضم عضو جديد إلى الجمعية','joined',v_event);
  END IF;
$o1$,
$n1$  v_event := private.publish_association_event(
    p_association_id := v_assoc.id, p_actor_user_id := v_uid,
    p_event_type := 'member_joined', p_entity_type := 'membership', p_entity_id := v_membership,
    p_visibility := 'all', p_before := NULL,
    p_after := jsonb_build_object('shares',v_inv.shares_requested,'legacy_invitation',true),
    p_feed_type := 'joined', p_subject_user_id := v_uid,
    p_feed_title := 'انضمام عضو جديد', p_feed_body := 'انضم عضو جديد إلى الجمعية',
    p_chat_body := 'انضم عضو جديد إلى الجمعية',
    p_public := '{}'::jsonb, p_exclude_user_ids := ARRAY[v_uid]
  );
$n1$);

select pg_temp.patch_fn('private.accept_legacy_invitation_by_id(uuid)',
$o2$  INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data)
  VALUES(v_assoc.id,v_uid,'member_joined','membership',v_membership,'all',
    jsonb_build_object('shares',v_inv.shares_requested,'legacy_invitation',true))
  RETURNING id INTO v_event;

  IF EXISTS(SELECT 1 FROM public.association_notification_settings s
    WHERE s.association_id=v_assoc.id AND 'joined'=ANY(s.enabled_types)) THEN
    INSERT INTO public.chat_messages(association_id,kind,body,system_type,event_id)
    VALUES(v_assoc.id,'system','انضم عضو جديد إلى الجمعية','joined',v_event);
  END IF;
$o2$,
$n2$  v_event := private.publish_association_event(
    p_association_id := v_assoc.id, p_actor_user_id := v_uid,
    p_event_type := 'member_joined', p_entity_type := 'membership', p_entity_id := v_membership,
    p_visibility := 'all', p_before := NULL,
    p_after := jsonb_build_object('shares',v_inv.shares_requested,'legacy_invitation',true),
    p_feed_type := 'joined', p_subject_user_id := v_uid,
    p_feed_title := 'انضمام عضو جديد', p_feed_body := 'انضم عضو جديد إلى الجمعية',
    p_chat_body := 'انضم عضو جديد إلى الجمعية',
    p_public := '{}'::jsonb, p_exclude_user_ids := ARRAY[v_uid]
  );
$n2$);

select pg_temp.patch_fn('private.approve_join_request(uuid)',
$o3$  INSERT INTO public.association_events(
    association_id, actor_user_id, event_type, entity_type, entity_id, visibility, after_data
  ) VALUES (
    v_a.id, v_uid, 'member_joined', 'membership', v_membership, 'all',
    jsonb_build_object('shares',v_share_ids,'source','join_request')
  ) RETURNING id INTO v_event;

  IF EXISTS(
    SELECT 1 FROM public.association_notification_settings s
    WHERE s.association_id = v_a.id AND 'joined' = ANY(s.enabled_types)
  ) THEN
    INSERT INTO public.chat_messages(association_id,kind,body,system_type,event_id)
    VALUES(v_a.id,'system','تم اعتماد طلب انضمام عضو جديد','joined',v_event);
  END IF;
$o3$,
$n3$  v_event := private.publish_association_event(
    p_association_id := v_a.id, p_actor_user_id := v_uid,
    p_event_type := 'member_joined', p_entity_type := 'membership', p_entity_id := v_membership,
    p_visibility := 'all', p_before := NULL,
    p_after := jsonb_build_object('shares',v_share_ids,'source','join_request'),
    p_feed_type := 'joined', p_subject_user_id := v_req.applicant_user_id,
    p_feed_title := 'انضمام عضو جديد', p_feed_body := 'انضم عضو جديد إلى الجمعية',
    p_chat_body := 'تم اعتماد طلب انضمام عضو جديد',
    p_public := '{}'::jsonb, p_exclude_user_ids := ARRAY[v_req.applicant_user_id, v_uid]
  );
$n3$);

-- ---------------------------------------------------------------------
-- Retire attendance (the table stays; no product path depends on it)
-- ---------------------------------------------------------------------
create or replace function private.set_cycle_attendance(p_cycle_id uuid, p_membership_id uuid, p_present boolean)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
begin
  raise exception 'تم إيقاف تسجيل الحضور؛ لم يعد شرطًا للقرعة' using errcode = '0A000';
end;
$function$;

-- Retire the legacy (non-unified) creation path that still accepted quorum.
-- The app only calls create_association_unified.
create or replace function private.create_association(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
begin
  raise exception 'تم إيقاف هذا المسار؛ استخدم إنشاء الجمعية الموحد (create_association_unified)' using errcode = '0A000';
end;
$function$;

-- ---------------------------------------------------------------------
-- Association financial summary (manager only).
-- Cumulative over all cycles up to the current round, so arrears are never hidden
-- by a newer installment. Status is derived, not stored.
-- ---------------------------------------------------------------------
create or replace function private.get_association_financial_summary(p_association_id uuid)
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
  v_today date;
  v_scope uuid[];
  v_result jsonb;
begin
  if v_uid is null then raise exception 'يجب تسجيل الدخول' using errcode = '28000'; end if;
  select * into v_a from public.associations where id = p_association_id and manager_user_id = v_uid;
  if not found then raise exception 'الملخص المالي متاح لمدير الجمعية فقط' using errcode = '42501'; end if;

  select count(*) + 1 into v_round from public.draws where association_id = p_association_id;
  v_today := (now() at time zone v_a.time_zone)::date;
  select array_agg(c.id) into v_scope
  from public.association_cycles c
  where c.association_id = p_association_id and c.cycle_no <= v_round;

  with st as (
    select o.membership_id, o.cycle_id, c.cycle_no, o.shares_count, o.amount_minor,
           (r.id is not null) as paid,
           private.derive_installment_status(r.id is not null, p.starts_on, p.ends_on, v_today) as status
    from public.installment_obligations o
    join public.installment_periods p on p.id = o.period_id
    join public.association_cycles c on c.id = o.cycle_id
    left join public.installment_receipts r on r.obligation_id = o.id and r.status = 'active'
    where o.association_id = p_association_id and o.cycle_id = any(v_scope)
  )
  select jsonb_build_object(
    'association_id', p_association_id,
    'as_of', v_today,
    'currency', v_a.currency,
    'current_round', v_round,
    'totals', (select jsonb_build_object(
        'due_minor', coalesce(sum(amount_minor), 0),
        'collected_minor', coalesce(sum(amount_minor) filter (where paid), 0),
        'remaining_minor', coalesce(sum(amount_minor) filter (where not paid), 0),
        'overdue_minor', coalesce(sum(amount_minor) filter (where status = 'late'), 0),
        'obligations', count(*),
        'paid_count', count(*) filter (where paid),
        'due_count', count(*) filter (where status = 'due'),
        'late_count', count(*) filter (where status = 'late'),
        'upcoming_count', count(*) filter (where status = 'upcoming')
      ) from st),
    'shares', (select jsonb_build_object(
        'total', coalesce(sum(m.shares), 0),
        'complete', coalesce(sum(m.shares) filter (where m.all_paid), 0),
        'incomplete', coalesce(sum(m.shares) filter (where not m.all_paid), 0)
      ) from (select membership_id, max(shares_count) as shares, bool_and(paid) as all_paid
              from st group by membership_id) m),
    'cycles', coalesce((select jsonb_agg(jsonb_build_object(
        'cycle_id', x.cycle_id, 'cycle_no', x.cycle_no,
        'due_minor', x.due, 'collected_minor', x.coll,
        'remaining_minor', x.due - x.coll, 'overdue_minor', x.x_late) order by x.cycle_no)
      from (select cycle_id, cycle_no, sum(amount_minor) as due,
                   coalesce(sum(amount_minor) filter (where paid), 0) as coll,
                   coalesce(sum(amount_minor) filter (where status = 'late'), 0) as x_late
            from st group by cycle_id, cycle_no) x), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
        'membership_id', mm.membership_id, 'user_id', mb.user_id, 'name', pr.full_name,
        'shares', mm.shares, 'due_minor', mm.due, 'collected_minor', mm.coll,
        'remaining_minor', mm.due - mm.coll, 'overdue_minor', mm.x_late,
        'late_count', mm.late_n, 'complete', mm.all_paid) order by pr.full_name)
      from (select membership_id, max(shares_count) as shares, sum(amount_minor) as due,
                   coalesce(sum(amount_minor) filter (where paid), 0) as coll,
                   coalesce(sum(amount_minor) filter (where status = 'late'), 0) as x_late,
                   count(*) filter (where status = 'late') as late_n,
                   bool_and(paid) as all_paid
            from st group by membership_id) mm
      join public.association_memberships mb on mb.id = mm.membership_id
      join public.profiles pr on pr.id = mb.user_id), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function private.get_association_financial_summary(uuid) from public, anon, service_role;
grant execute on function private.get_association_financial_summary(uuid) to authenticated;

create or replace function public.get_association_financial_summary(p_association_id uuid)
returns jsonb
language sql
set search_path to ''
as $function$ select private.get_association_financial_summary(p_association_id); $function$;

revoke all on function public.get_association_financial_summary(uuid) from public, anon, service_role;
grant execute on function public.get_association_financial_summary(uuid) to authenticated;
