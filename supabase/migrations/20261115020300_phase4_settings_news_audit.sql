-- SAHM phases 2-5 database batch, part 4/5: publishing settings, member news feed, admin audit log.
-- Raw association_events are an audit record readable by the manager only (policy changed in part 1).
-- Members read the sanitized feed through get_association_news; names are resolved on the server.

-- ---------------------------------------------------------------------
-- Channel settings: feed (news center), chat, and member-name visibility per news type.
-- Manager only; allowed at any time (publishing settings are not part of the locked agreement).
-- NULL argument = keep the current value.
-- ---------------------------------------------------------------------
create or replace function private.set_association_notification_settings(
  p_association_id uuid,
  p_feed_types text[] default null,
  p_chat_types text[] default null,
  p_name_visible_types text[] default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_allowed constant text[] := array['received','completed','late','drawSoon','drawDue','drawResult','joined','motivate'];
  v_cur public.association_notification_settings%rowtype;
  v_had boolean;
  v_feed text[];
  v_chat text[];
  v_names text[];
begin
  if v_uid is null or not private.is_association_manager(p_association_id) then
    raise exception 'إعدادات النشر متاحة لمدير الجمعية فقط' using errcode = '42501';
  end if;
  if p_feed_types is null and p_chat_types is null and p_name_visible_types is null then
    raise exception 'لا توجد إعدادات للتحديث' using errcode = '22023';
  end if;
  if (p_feed_types is not null and exists (select 1 from unnest(p_feed_types) x where x is null or not (x = any(v_allowed))))
     or (p_chat_types is not null and exists (select 1 from unnest(p_chat_types) x where x is null or not (x = any(v_allowed))))
     or (p_name_visible_types is not null and exists (select 1 from unnest(p_name_visible_types) x where x is null or not (x = any(v_allowed)))) then
    raise exception 'نوع خبر غير معروف' using errcode = '22023';
  end if;

  select * into v_cur from public.association_notification_settings where association_id = p_association_id;
  v_had := found;

  v_feed := coalesce(p_feed_types, case when v_had then v_cur.feed_enabled_types else v_allowed end);
  v_chat := coalesce(p_chat_types, case when v_had then v_cur.chat_enabled_types else v_allowed end);
  v_names := coalesce(p_name_visible_types, case when v_had then v_cur.name_visible_types else array['drawResult']::text[] end);

  v_feed := coalesce((select array_agg(distinct x order by x) from unnest(v_feed) x), '{}'::text[]);
  v_chat := coalesce((select array_agg(distinct x order by x) from unnest(v_chat) x), '{}'::text[]);
  v_names := coalesce((select array_agg(distinct x order by x) from unnest(v_names) x), '{}'::text[]);

  -- enabled_types is the legacy field that controlled chat messages; keep it equal to the chat channel.
  insert into public.association_notification_settings(
    association_id, enabled_types, feed_enabled_types, chat_enabled_types, name_visible_types, updated_by_user_id, updated_at
  ) values (
    p_association_id, v_chat, v_feed, v_chat, v_names, v_uid, now()
  )
  on conflict (association_id) do update set
    enabled_types = excluded.enabled_types,
    feed_enabled_types = excluded.feed_enabled_types,
    chat_enabled_types = excluded.chat_enabled_types,
    name_visible_types = excluded.name_visible_types,
    updated_by_user_id = excluded.updated_by_user_id,
    updated_at = now();

  perform private.publish_association_event(
    p_association_id := p_association_id, p_actor_user_id := v_uid,
    p_event_type := 'notification_settings_updated', p_entity_type := 'notification_settings', p_entity_id := p_association_id,
    p_visibility := 'manager',
    p_before := case when v_had then jsonb_build_object(
      'feed', v_cur.feed_enabled_types, 'chat', v_cur.chat_enabled_types, 'names', v_cur.name_visible_types) else null end,
    p_after := jsonb_build_object('feed', v_feed, 'chat', v_chat, 'names', v_names)
  );

  return jsonb_build_object('feed_enabled_types', v_feed, 'chat_enabled_types', v_chat, 'name_visible_types', v_names);
end;
$function$;

-- Legacy single-list RPC keeps working: it sets both channels; name visibility is untouched.
create or replace function private.set_association_notification_types(p_association_id uuid, p_enabled_types text[])
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_allowed constant text[] := array['received','completed','late','drawSoon','drawDue','drawResult','joined','motivate'];
begin
  if v_uid is null or not private.is_association_manager(p_association_id) then
    raise exception 'إعدادات النشر متاحة لمدير الجمعية فقط' using errcode = '42501';
  end if;
  if p_enabled_types is null or exists (select 1 from unnest(p_enabled_types) x where x is null or not (x = any(v_allowed))) then
    raise exception 'نوع إشعار غير معروف' using errcode = '22023';
  end if;
  insert into public.association_notification_settings(
    association_id, enabled_types, feed_enabled_types, chat_enabled_types, updated_by_user_id, updated_at
  ) values (
    p_association_id, p_enabled_types, p_enabled_types, p_enabled_types, v_uid, now()
  )
  on conflict (association_id) do update set
    enabled_types = excluded.enabled_types,
    feed_enabled_types = excluded.feed_enabled_types,
    chat_enabled_types = excluded.chat_enabled_types,
    updated_by_user_id = excluded.updated_by_user_id,
    updated_at = now();
end;
$function$;

-- ---------------------------------------------------------------------
-- Member-facing association news.
-- Only events published through private.publish_association_event carry a _feed block.
-- A type is returned only while it is enabled in feed_enabled_types.
-- The subject (member) name/avatar/id is returned only when the type is in name_visible_types;
-- raw before_data/after_data are never returned.
-- ---------------------------------------------------------------------
create or replace function private.get_association_news(p_association_id uuid, p_limit integer default 50, p_before timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_feed text[];
  v_names text[];
  v_result jsonb;
begin
  if v_uid is null then raise exception 'يجب تسجيل الدخول' using errcode = '28000'; end if;
  if not (private.is_association_manager(p_association_id) or private.is_association_member(p_association_id)) then
    raise exception 'أخبار الجمعية متاحة لأعضائها ومديرها فقط' using errcode = '42501';
  end if;

  select s.feed_enabled_types, s.name_visible_types into v_feed, v_names
  from public.association_notification_settings s where s.association_id = p_association_id;
  if not found then
    v_feed := array['received','completed','late','drawSoon','drawDue','drawResult','joined','motivate'];
    v_names := array['drawResult'];
  end if;

  select coalesce(jsonb_agg(t.item order by t.occurred_at desc, t.event_id desc), '[]'::jsonb) into v_result
  from (
    select e.id as event_id, e.occurred_at,
      jsonb_build_object(
        'event_id', e.id,
        'occurred_at', e.occurred_at,
        'type', f.ftype,
        'title', e.after_data->'_feed'->>'title',
        'body', e.after_data->'_feed'->>'body',
        'public', coalesce(e.after_data->'_feed'->'public', '{}'::jsonb),
        'subject_visible', (f.ftype = any(v_names) and f.subject_id is not null),
        'subject_user_id', case when f.ftype = any(v_names) then f.subject_id end,
        'subject_name', case when f.ftype = any(v_names) then pr.full_name end,
        'subject_avatar_key', case when f.ftype = any(v_names) then pr.avatar_key end
      ) as item
    from public.association_events e
    cross join lateral (
      select e.after_data->'_feed'->>'type' as ftype,
             nullif(e.after_data->'_feed'->>'subject_user_id', '')::uuid as subject_id
    ) f
    left join public.profiles pr on pr.id = f.subject_id
    where e.association_id = p_association_id
      and e.visibility in ('all', 'member')
      and e.after_data ? '_feed'
      and f.ftype = any(v_feed)
      and (p_before is null or e.occurred_at < p_before)
    order by e.occurred_at desc, e.id desc
    limit v_limit
  ) t;

  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------
-- Manager operations log (audit), separate from the news feed.
-- ---------------------------------------------------------------------
create or replace function private.get_association_audit_log(p_association_id uuid, p_limit integer default 100, p_before timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_result jsonb;
begin
  if v_uid is null then raise exception 'يجب تسجيل الدخول' using errcode = '28000'; end if;
  if not private.is_association_manager(p_association_id) then
    raise exception 'سجل العمليات متاح لمدير الجمعية فقط' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(t.item order by t.occurred_at desc, t.event_id desc), '[]'::jsonb) into v_result
  from (
    select e.id as event_id, e.occurred_at,
      jsonb_build_object(
        'event_id', e.id,
        'occurred_at', e.occurred_at,
        'event_type', e.event_type,
        'entity_type', e.entity_type,
        'entity_id', e.entity_id,
        'visibility', e.visibility,
        'actor_user_id', e.actor_user_id,
        'actor_name', pr.full_name,
        'before_data', e.before_data,
        'after_data', e.after_data
      ) as item
    from public.association_events e
    left join public.profiles pr on pr.id = e.actor_user_id
    where e.association_id = p_association_id
      and (p_before is null or e.occurred_at < p_before)
    order by e.occurred_at desc, e.id desc
    limit v_limit
  ) t;

  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------
-- Grants and public wrappers (same pattern as existing RPCs)
-- ---------------------------------------------------------------------
revoke all on function private.set_association_notification_settings(uuid,text[],text[],text[]) from public, anon, service_role;
revoke all on function private.get_association_news(uuid,integer,timestamptz) from public, anon, service_role;
revoke all on function private.get_association_audit_log(uuid,integer,timestamptz) from public, anon, service_role;
grant execute on function private.set_association_notification_settings(uuid,text[],text[],text[]) to authenticated;
grant execute on function private.get_association_news(uuid,integer,timestamptz) to authenticated;
grant execute on function private.get_association_audit_log(uuid,integer,timestamptz) to authenticated;

create or replace function public.set_association_notification_settings(
  p_association_id uuid, p_feed_types text[] default null, p_chat_types text[] default null, p_name_visible_types text[] default null)
returns jsonb language sql set search_path to ''
as $function$ select private.set_association_notification_settings(p_association_id, p_feed_types, p_chat_types, p_name_visible_types); $function$;

create or replace function public.get_association_news(p_association_id uuid, p_limit integer default 50, p_before timestamptz default null)
returns jsonb language sql set search_path to ''
as $function$ select private.get_association_news(p_association_id, p_limit, p_before); $function$;

create or replace function public.get_association_audit_log(p_association_id uuid, p_limit integer default 100, p_before timestamptz default null)
returns jsonb language sql set search_path to ''
as $function$ select private.get_association_audit_log(p_association_id, p_limit, p_before); $function$;

revoke all on function public.set_association_notification_settings(uuid,text[],text[],text[]) from public, anon, service_role;
revoke all on function public.get_association_news(uuid,integer,timestamptz) from public, anon, service_role;
revoke all on function public.get_association_audit_log(uuid,integer,timestamptz) from public, anon, service_role;
grant execute on function public.set_association_notification_settings(uuid,text[],text[],text[]) to authenticated;
grant execute on function public.get_association_news(uuid,integer,timestamptz) to authenticated;
grant execute on function public.get_association_audit_log(uuid,integer,timestamptz) to authenticated;
