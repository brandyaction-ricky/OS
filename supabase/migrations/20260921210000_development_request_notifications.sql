begin;

do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.os_records'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%record_type%'
  limit 1;
  if constraint_name is not null then
    execute format('alter table public.os_records drop constraint %I', constraint_name);
  end if;
end;
$$;

alter table public.os_records add constraint os_records_record_type_check check (record_type in (
  'project', 'task', 'goal', 'kpi', 'decision', 'meeting', 'ai_job',
  'development_log', 'deployment', 'development_comment', 'development_notification',
  'content_topic', 'content_script', 'content_package', 'content_short',
  'content_publish', 'content_metric', 'skill', 'knowledge_link',
  'revenue', 'funnel', 'crm_action', 'customer', 'brand',
  'connection', 'access_rule', 'company_setting', 'channel',
  'leave_balance', 'leave_request', 'expense', 'contract', 'subscription', 'company_document'
));

create index if not exists os_records_development_notification_inbox_idx
  on public.os_records(owner_id, status, created_at desc, id desc)
  where archived_at is null and record_type = 'development_notification';

create unique index if not exists os_records_development_notification_dedupe_idx
  on public.os_records((metadata->>'dedupeKey'))
  where archived_at is null and record_type = 'development_notification';

create or replace function public.os_development_comment_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  reply_id uuid;
  mention_ids jsonb := coalesce(new.metadata->'mentionIds', '[]'::jsonb);
  mention_names jsonb := coalesce(new.metadata->'mentionNames', '[]'::jsonb);
begin
  if tg_op = 'DELETE' and old.record_type = 'development_comment' then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_COMMENT_IMMUTABLE';
  end if;
  if tg_op = 'DELETE' then return old; end if;

  if tg_op = 'UPDATE' and (old.record_type = 'development_comment' or new.record_type = 'development_comment') then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_COMMENT_IMMUTABLE';
  end if;
  if new.record_type <> 'development_comment' then return new; end if;

  if new.parent_id is null or not exists (
    select 1 from public.os_records request
    where request.id = new.parent_id
      and request.record_type = 'ai_job'
      and request.metadata->>'kind' = 'development_request'
      and request.archived_at is null
  ) then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_COMMENT_REQUEST_INVALID';
  end if;
  if btrim(coalesce(new.description, '')) = '' or char_length(new.description) > 5000 then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_COMMENT_BODY_INVALID';
  end if;
  if jsonb_typeof(new.metadata) <> 'object'
    or coalesce(new.metadata->>'kind', '') <> 'development_comment'
    or coalesce(new.metadata->>'requestId', '') <> new.parent_id::text
    or coalesce(new.metadata->>'authorName', '') = ''
    or char_length(new.metadata->>'authorName') > 200
    or coalesce(new.metadata->>'authorType', '') not in ('member', 'agent')
    or jsonb_typeof(mention_ids) <> 'array'
    or jsonb_typeof(mention_names) <> 'array'
    or jsonb_array_length(mention_ids) > 12
    or jsonb_array_length(mention_names) <> jsonb_array_length(mention_ids)
    or exists (
      select 1 from jsonb_each(new.metadata) item
      where item.key not in ('kind', 'requestId', 'replyTo', 'authorName', 'authorType', 'mentionIds', 'mentionNames')
    )
    or exists (
      select 1 from jsonb_array_elements(mention_ids) item
      where jsonb_typeof(item) <> 'string' or trim(both '"' from item::text) !~ '^[0-9a-fA-F-]{36}$'
    )
    or exists (
      select 1 from jsonb_array_elements(mention_names) item
      where jsonb_typeof(item) <> 'string' or char_length(trim(both '"' from item::text)) > 200
    )
    or (select count(*) from jsonb_array_elements_text(mention_ids))
      <> (select count(distinct value) from jsonb_array_elements_text(mention_ids)) then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_COMMENT_METADATA_INVALID';
  end if;

  if coalesce(new.metadata->>'replyTo', '') <> '' then
    begin
      reply_id := (new.metadata->>'replyTo')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '23514', message = 'DEVELOPMENT_COMMENT_REPLY_INVALID';
    end;
    if not exists (
      select 1 from public.os_records parent_comment
      where parent_comment.id = reply_id
        and parent_comment.record_type = 'development_comment'
        and parent_comment.parent_id = new.parent_id
        and parent_comment.metadata->>'kind' = 'development_comment'
        and coalesce(parent_comment.metadata->>'replyTo', '') = ''
        and parent_comment.archived_at is null
    ) then
      raise exception using errcode = '23514', message = 'DEVELOPMENT_COMMENT_REPLY_INVALID';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.os_development_notification_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' and old.record_type = 'development_notification' then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_NOTIFICATION_IMMUTABLE';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and old.record_type = 'development_notification' then
    if new.record_type <> old.record_type
      or (to_jsonb(new) - array['status','metadata','updated_by','updated_at','version'])
        is distinct from (to_jsonb(old) - array['status','metadata','updated_by','updated_at','version'])
      or (new.metadata - array['deliveredAt','readAt'])
        is distinct from (old.metadata - array['deliveredAt','readAt']) then
      raise exception using errcode = '23514', message = 'DEVELOPMENT_NOTIFICATION_IMMUTABLE';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.record_type = 'development_notification' and old.record_type <> 'development_notification' then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_NOTIFICATION_IMMUTABLE';
  end if;
  if new.record_type <> 'development_notification' then return new; end if;

  if new.parent_id is null or not exists (
    select 1 from public.os_records request
    where request.id = new.parent_id
      and request.record_type = 'ai_job'
      and request.metadata->>'kind' = 'development_request'
      and request.archived_at is null
  ) or new.owner_id is null or not exists (
    select 1 from public.os_profiles profile where profile.id = new.owner_id and profile.is_active
  ) then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_NOTIFICATION_TARGET_INVALID';
  end if;
  if new.title not in ('개발 요청 멘션', '개발 요청 담당 지정')
    or new.description <> ''
    or new.status not in ('unread', 'read')
    or jsonb_typeof(new.metadata) <> 'object'
    or coalesce(new.metadata->>'kind', '') <> 'development_notification'
    or coalesce(new.metadata->>'requestId', '') <> new.parent_id::text
    or coalesce(new.metadata->>'reason', '') not in ('mention', 'assignment')
    or coalesce(new.metadata->>'sourceId', '') = ''
    or coalesce(new.metadata->>'actorId', '') = ''
    or coalesce(new.metadata->>'actorName', '') = ''
    or char_length(new.metadata->>'actorName') > 200
    or coalesce(new.metadata->>'generatedAt', '') = ''
    or coalesce(new.metadata->>'dedupeKey', '') = ''
    or char_length(new.metadata->>'dedupeKey') > 500
    or exists (
      select 1 from jsonb_each(new.metadata) item
      where item.key not in ('kind', 'reason', 'requestId', 'sourceId', 'actorId', 'actorName', 'generatedAt', 'deliveredAt', 'readAt', 'dedupeKey')
        or jsonb_typeof(item.value) <> 'string'
    )
    or (new.status = 'read' and coalesce(new.metadata->>'readAt', '') = '') then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_NOTIFICATION_METADATA_INVALID';
  end if;
  return new;
end;
$$;

drop trigger if exists os_development_notification_guard_trigger on public.os_records;
create trigger os_development_notification_guard_trigger
before insert or update or delete on public.os_records
for each row execute function public.os_development_notification_guard();

create or replace function public.os_create_development_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recipient uuid;
  actor_name text;
  generated_at text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if tg_op = 'INSERT' and new.record_type = 'development_comment' then
    for recipient in
      select distinct profile.id
      from public.os_profiles profile
      join (
        select value::uuid as id
        from jsonb_array_elements_text(coalesce(new.metadata->'mentionIds', '[]'::jsonb))
        union all
        select parent_comment.created_by
        from public.os_records parent_comment
        where coalesce(new.metadata->>'replyTo', '') <> ''
          and parent_comment.id = nullif(new.metadata->>'replyTo', '')::uuid
          and parent_comment.record_type = 'development_comment'
      ) targets on targets.id = profile.id
      where profile.is_active and profile.id <> new.created_by
    loop
      insert into public.os_records (
        record_type, title, description, status, priority, parent_id, brand, team,
        owner_id, created_by, updated_by, metadata
      ) values (
        'development_notification', '개발 요청 멘션', '', 'unread', 'normal', new.parent_id, new.brand, new.team,
        recipient, new.created_by, new.created_by,
        jsonb_build_object(
          'kind', 'development_notification', 'reason', 'mention', 'requestId', new.parent_id::text,
          'sourceId', new.id::text, 'actorId', new.created_by::text,
          'actorName', new.metadata->>'authorName', 'generatedAt', generated_at,
          'deliveredAt', '', 'readAt', '', 'dedupeKey', 'mention:' || new.id::text || ':' || recipient::text
        )
      ) on conflict do nothing;
    end loop;
  elsif tg_op = 'UPDATE'
    and new.record_type = 'ai_job'
    and new.metadata->>'kind' = 'development_request'
    and new.assignee_id is distinct from old.assignee_id
    and new.assignee_id is not null
    and new.assignee_id <> new.updated_by then
    select coalesce(nullif(profile.display_name, ''), split_part(profile.email, '@', 1), '구성원')
      into actor_name from public.os_profiles profile where profile.id = new.updated_by;
    insert into public.os_records (
      record_type, title, description, status, priority, parent_id, brand, team,
      owner_id, created_by, updated_by, metadata
    ) values (
      'development_notification', '개발 요청 담당 지정', '', 'unread', 'normal', new.id, new.brand, new.team,
      new.assignee_id, new.updated_by, new.updated_by,
      jsonb_build_object(
        'kind', 'development_notification', 'reason', 'assignment', 'requestId', new.id::text,
        'sourceId', new.id::text, 'actorId', new.updated_by::text,
        'actorName', coalesce(actor_name, '구성원'), 'generatedAt', generated_at,
        'deliveredAt', '', 'readAt', '', 'dedupeKey', 'assignment:' || new.id::text || ':' || new.version::text || ':' || new.assignee_id::text
      )
    ) on conflict do nothing;
  end if;
  return new;
end;
$$;

revoke execute on function public.os_create_development_notifications()
  from public, anon, authenticated;
grant execute on function public.os_create_development_notifications()
  to service_role;

drop trigger if exists os_create_development_notifications_trigger on public.os_records;
create trigger os_create_development_notifications_trigger
after insert or update on public.os_records
for each row execute function public.os_create_development_notifications();

commit;
