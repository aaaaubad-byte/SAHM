-- SAHM phases 2-5 database batch, part 5/5: production time events.
-- One idempotent processor, scheduled inside Supabase with pg_cron (available in this project).
-- Every notification carries a stable idempotency key; every published event is checked
-- against the append-only event log first, so re-running the job never duplicates anything.

create extension if not exists pg_cron with schema pg_catalog;

create or replace function private.process_time_events()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_run bigint;
  v_a record;
  v_c record;
  v_cy record;
  v_today date;
  v_round integer;
  v_due date;
  v_n integer;
  v_assoc integer := 0;
  v_late integer := 0;
  v_member_complete integer := 0;
  v_cycle_complete integer := 0;
  v_draw_soon integer := 0;
  v_draw_due integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_summary jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('sahm.process_time_events', 0)) then
    return jsonb_build_object('skipped', true, 'reason', 'another run is in progress');
  end if;

  insert into private.time_event_runs(started_at) values (now()) returning id into v_run;
  delete from private.time_event_runs where started_at < now() - interval '30 days';

  for v_a in select a.id, a.time_zone from public.associations a where a.status = 'active' order by a.id loop
    begin
      v_assoc := v_assoc + 1;
      v_today := (now() at time zone v_a.time_zone)::date;
      select count(*) + 1 into v_round from public.draws where association_id = v_a.id;

      -- 1) Late installments: one personal notification per unpaid obligation whose period has ended.
      insert into public.notifications(user_id, association_id, type, title, body, related_entity_id, idempotency_key)
      select m.user_id, o.association_id, 'late', 'تأخر في سداد قسط',
             'لديك قسط متأخر في الجمعية، يرجى السداد في أقرب وقت', o.id, 'late:' || o.id::text
      from public.installment_obligations o
      join public.installment_periods p on p.id = o.period_id
      join public.association_memberships m on m.id = o.membership_id and m.status = 'active'
      left join public.user_preferences up on up.user_id = m.user_id
      where o.association_id = v_a.id
        and p.ends_on < v_today
        and not exists (select 1 from public.installment_receipts r where r.obligation_id = o.id and r.status = 'active')
        and coalesce(up.notifications_enabled, true)
      on conflict (idempotency_key) do nothing;
      get diagnostics v_n = row_count;
      v_late := v_late + v_n;

      -- 2) A member has finished every installment of a cycle.
      insert into public.notifications(user_id, association_id, type, title, body, related_entity_id, idempotency_key)
      select m.user_id, v_a.id, 'completed', 'اكتملت أقساطك',
             'تم تسجيل استلام جميع أقساطك في هذه الدورة', c.id,
             'member-complete:' || m.id::text || ':' || c.id::text
      from public.association_cycles c
      join public.association_memberships m on m.association_id = c.association_id and m.status = 'active'
      left join public.user_preferences up on up.user_id = m.user_id
      where c.association_id = v_a.id
        and (select count(*) from public.installment_obligations o where o.cycle_id = c.id and o.membership_id = m.id) > 0
        and (select count(*) from public.installment_obligations o where o.cycle_id = c.id and o.membership_id = m.id)
            = (select count(*) from public.installment_periods p where p.cycle_id = c.id)
        and not exists (
          select 1 from public.installment_obligations o
          where o.cycle_id = c.id and o.membership_id = m.id
            and not exists (select 1 from public.installment_receipts r where r.obligation_id = o.id and r.status = 'active'))
        and coalesce(up.notifications_enabled, true)
      on conflict (idempotency_key) do nothing;
      get diagnostics v_n = row_count;
      v_member_complete := v_member_complete + v_n;

      -- 3) Whole-cycle collection complete: one published event per cycle (feed type "completed").
      for v_cy in
        select c.id, c.cycle_no
        from public.association_cycles c
        where c.association_id = v_a.id and c.cycle_no <= v_round
          and exists (select 1 from public.installment_obligations o where o.cycle_id = c.id)
          and not exists (
            select 1 from public.association_events e
            where e.association_id = v_a.id and e.event_type = 'cycle_collection_complete' and e.entity_id = c.id)
        order by c.cycle_no
      loop
        if coalesce((private.compute_draw_readiness(v_a.id, v_cy.id, true)->>'ready')::boolean, false) then
          perform private.publish_association_event(
            p_association_id := v_a.id, p_actor_user_id := null,
            p_event_type := 'cycle_collection_complete', p_entity_type := 'cycle', p_entity_id := v_cy.id,
            p_visibility := 'all', p_before := null,
            p_after := jsonb_build_object('cycle_no', v_cy.cycle_no),
            p_feed_type := 'completed', p_subject_user_id := null,
            p_feed_title := 'اكتمل تحصيل الدورة', p_feed_body := 'اكتمل تحصيل جميع أقساط الدورة',
            p_chat_body := 'اكتمل تحصيل أقساط الدورة',
            p_public := jsonb_build_object('cycle_no', v_cy.cycle_no)
          );
          v_cycle_complete := v_cycle_complete + 1;
        end if;
      end loop;

      -- 4) Draw approaching / draw due for the current round (no result yet).
      select c.id, c.cycle_no, c.ends_on, c.draw_scheduled_at into v_c
      from public.association_cycles c
      where c.association_id = v_a.id and c.cycle_no = v_round and c.status in ('scheduled', 'open');
      if found then
        v_due := v_c.ends_on + 1;

        if v_today >= v_due - 1
           and (v_today < v_due or (v_c.draw_scheduled_at is not null and now() < v_c.draw_scheduled_at))
           and not exists (
             select 1 from public.association_events e
             where e.association_id = v_a.id and e.event_type = 'draw_soon' and e.entity_id = v_c.id) then
          perform private.publish_association_event(
            p_association_id := v_a.id, p_actor_user_id := null,
            p_event_type := 'draw_soon', p_entity_type := 'cycle', p_entity_id := v_c.id,
            p_visibility := 'all', p_before := null,
            p_after := jsonb_build_object('round', v_round, 'due_on', v_due),
            p_feed_type := 'drawSoon', p_subject_user_id := null,
            p_feed_title := 'اقترب موعد القرعة', p_feed_body := 'يقترب موعد قرعة الجمعية',
            p_chat_body := 'اقترب موعد القرعة',
            p_public := jsonb_build_object('round', v_round, 'due_on', v_due, 'draw_scheduled_at', v_c.draw_scheduled_at)
          );
          v_draw_soon := v_draw_soon + 1;
        end if;

        if v_today >= v_due
           and (v_c.draw_scheduled_at is null or now() >= v_c.draw_scheduled_at)
           and not exists (
             select 1 from public.association_events e
             where e.association_id = v_a.id and e.event_type = 'draw_due' and e.entity_id = v_c.id) then
          perform private.publish_association_event(
            p_association_id := v_a.id, p_actor_user_id := null,
            p_event_type := 'draw_due', p_entity_type := 'cycle', p_entity_id := v_c.id,
            p_visibility := 'all', p_before := null,
            p_after := jsonb_build_object('round', v_round, 'due_on', v_due),
            p_feed_type := 'drawDue', p_subject_user_id := null,
            p_feed_title := 'حان موعد القرعة', p_feed_body := 'حان موعد قرعة الجمعية',
            p_chat_body := 'حان موعد القرعة',
            p_public := jsonb_build_object('round', v_round, 'due_on', v_due, 'draw_scheduled_at', v_c.draw_scheduled_at)
          );
          v_draw_due := v_draw_due + 1;
        end if;
      end if;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('association_id', v_a.id, 'error', sqlerrm));
    end;
  end loop;

  v_summary := jsonb_build_object(
    'associations', v_assoc, 'late_notifications', v_late,
    'member_completed_notifications', v_member_complete, 'cycle_collection_events', v_cycle_complete,
    'draw_soon_events', v_draw_soon, 'draw_due_events', v_draw_due,
    'errors', v_errors);

  update private.time_event_runs
     set finished_at = now(), ok = (jsonb_array_length(v_errors) = 0), summary = v_summary,
         error = case when jsonb_array_length(v_errors) = 0 then null else v_errors::text end
   where id = v_run;

  return v_summary;
end;
$function$;

revoke all on function private.process_time_events() from public, anon, authenticated, service_role;

-- Schedule inside Supabase: every 10 minutes (idempotent, safe to re-run).
select cron.schedule('sahm-process-time-events', '*/10 * * * *', $cron$select private.process_time_events();$cron$);
