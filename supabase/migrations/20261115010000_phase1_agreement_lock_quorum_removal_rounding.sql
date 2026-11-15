-- SAHM Phase 1 (docs/SAHM_DEVELOPMENT_GAP_PLAN.md, section 3.1 and 3.2)
--
-- 1) Unified agreement lock: once the association's local date (in associations.time_zone)
--    reaches start_date, membership, shares and agreement settings can no longer change.
--    The database is the final authority; locked_at is no longer the only criterion.
-- 2) Quorum is removed from the create/update contracts (the quorum_percent column and
--    cycle_attendance data are kept untouched; their removal is a later, separate decision).
-- 3) In 'count' installment mode the rounding remainder goes to the LAST installment.
--
-- Existing function definitions are patched in place (each patch must match exactly once,
-- otherwise the whole migration fails and nothing is changed).

create or replace function private.assert_association_agreement_open(p_association_id uuid)
 returns void
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_start date;
  v_tz text;
begin
  select a.start_date, a.time_zone into v_start, v_tz
  from public.associations a
  where a.id = p_association_id;

  if not found then
    raise exception 'الجمعية غير موجودة' using errcode = 'P0002';
  end if;

  if (now() at time zone v_tz)::date >= v_start then
    raise exception 'أُغلق اتفاق الجمعية عند تاريخ البداية؛ لا يمكن تعديل العضوية أو الأسهم أو الإعدادات' using errcode = '23514';
  end if;
end;
$function$;

revoke all on function private.assert_association_agreement_open(uuid) from public, anon, authenticated;

do $migration$
declare
  r record;
  p record;
  v_def text;
  v_n integer;
begin
  create temp table _sahm_patches (
    ord integer,
    fn regprocedure,
    old_text text,
    new_text text
  ) on commit drop;

  insert into _sahm_patches(ord, fn, old_text, new_text) values
  -- ===== agreement lock guard =====
  (1, 'private.add_shares(uuid,integer)'::regprocedure,
   $q$IF v_a.locked_at IS NOT NULL$q$,
   $q$PERFORM private.assert_association_agreement_open(v_aid);
  IF v_a.locked_at IS NOT NULL$q$),
  (2, 'private.remove_shares(uuid,integer)'::regprocedure,
   $q$IF v_a.locked_at IS NOT NULL OR EXISTS($q$,
   $q$PERFORM private.assert_association_agreement_open(v_aid);
  IF v_a.locked_at IS NOT NULL OR EXISTS($q$),
  (3, 'private.remove_member(uuid)'::regprocedure,
   $q$IF v_a.locked_at IS NOT NULL OR EXISTS($q$,
   $q$PERFORM private.assert_association_agreement_open(v_aid);
  IF v_a.locked_at IS NOT NULL OR EXISTS($q$),
  (4, 'private.update_association(uuid,jsonb)'::regprocedure,
   $q$IF v_a.locked_at IS NOT NULL OR EXISTS($q$,
   $q$PERFORM private.assert_association_agreement_open(p_association_id);
  IF v_a.locked_at IS NOT NULL OR EXISTS($q$),
  (5, 'private.accept_invitation(text)'::regprocedure,
   $q$IF v_assoc.locked_at IS NOT NULL OR v_assoc.status <> 'active' THEN$q$,
   $q$PERFORM private.assert_association_agreement_open(v_assoc.id);
  IF v_assoc.locked_at IS NOT NULL OR v_assoc.status <> 'active' THEN$q$),

  -- ===== quorum removal: update_association =====
  (10, 'private.update_association(uuid,jsonb)'::regprocedure,
   $q$v_quorum integer;$q$, ''),
  (11, 'private.update_association(uuid,jsonb)'::regprocedure,
   $q$v_quorum := coalesce(nullif(p_payload->>'quorum','')::integer,v_a.quorum_percent);$q$, ''),
  (12, 'private.update_association(uuid,jsonb)'::regprocedure,
   $q$IF v_quorum NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'نصاب الحضور غير صالح' USING ERRCODE='22023'; END IF;$q$, ''),
  (13, 'private.update_association(uuid,jsonb)'::regprocedure,
   $q$quorum_percent=v_quorum,rules=v_rules$q$,
   $q$rules=v_rules$q$),
  (14, 'private.update_association(uuid,jsonb)'::regprocedure,
   $q$,'quorum_percent',v_a.quorum_percent$q$, ''),
  (15, 'private.update_association(uuid,jsonb)'::regprocedure,
   $q$,'quorum_percent',v_quorum$q$, ''),

  -- ===== quorum removal: create_association_unified =====
  (20, 'private.create_association_unified(jsonb)'::regprocedure,
   $q$v_quorum integer;$q$, ''),
  (21, 'private.create_association_unified(jsonb)'::regprocedure,
   $q$v_quorum := coalesce(nullif(p_payload->>'quorum', '')::integer, 66);$q$, ''),
  (22, 'private.create_association_unified(jsonb)'::regprocedure,
   $q$  IF v_quorum NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'نصاب الحضور غير صالح' USING ERRCODE = '22023';
  END IF;
$q$, ''),
  (23, 'private.create_association_unified(jsonb)'::regprocedure,
   $q$manager_participates, quorum_percent, rules$q$,
   $q$manager_participates, rules$q$),
  (24, 'private.create_association_unified(jsonb)'::regprocedure,
   $q$NULL, NULL, v_manager_participates, v_quorum, v_rules$q$,
   $q$NULL, NULL, v_manager_participates, v_rules$q$),

  -- ===== last-installment rounding (count mode) =====
  (30, 'private.create_association_unified(jsonb)'::regprocedure,
   $q$v_period_amount := v_amount_base + CASE WHEN v_i <= v_amount_rem THEN 1 ELSE 0 END;$q$,
   $q$v_period_amount := v_amount_base + CASE WHEN v_i = v_installments THEN v_amount_rem ELSE 0 END;$q$),
  (31, 'private.rebuild_open_association_obligations(uuid)'::regprocedure,
   $q$v_period_amount := v_amount_base + CASE WHEN v_i <= v_amount_rem THEN 1 ELSE 0 END;$q$,
   $q$v_period_amount := v_amount_base + CASE WHEN v_i = v_cycle.installments_count THEN v_amount_rem ELSE 0 END;$q$);

  for r in select distinct fn from _sahm_patches order by fn loop
    v_def := pg_get_functiondef(r.fn);

    for p in select * from _sahm_patches where fn = r.fn order by ord loop
      v_n := (length(v_def) - length(replace(v_def, p.old_text, ''))) / length(p.old_text);
      if v_n <> 1 then
        raise exception 'patch % matched % times in %', p.ord, v_n, r.fn::text;
      end if;
      v_def := replace(v_def, p.old_text, p.new_text);
    end loop;

    execute v_def;
  end loop;
end
$migration$;
