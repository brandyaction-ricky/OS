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
  'development_log', 'deployment', 'development_comment', 'development_notification', 'notification',
  'content_topic', 'content_script', 'content_package', 'content_short',
  'content_publish', 'content_metric', 'skill', 'knowledge_link',
  'revenue', 'funnel', 'crm_action', 'customer', 'brand',
  'connection', 'access_rule', 'company_setting', 'channel',
  'leave_balance', 'leave_request', 'expense', 'contract', 'subscription', 'company_document'
));


-- New notifications are API-only. The API authenticates the recipient and reads
-- the source with the recipient's RLS client before returning titles or counts.
create policy os_notification_api_only on public.os_records as restrictive
for all to authenticated using (record_type <> 'notification')
with check (record_type <> 'notification');
create index os_notification_inbox_idx on public.os_records(owner_id, created_at desc, id desc)
where record_type = 'notification' and archived_at is null;
create unique index os_notification_dedupe_idx on public.os_records((metadata->>'dedupeKey'))
where record_type = 'notification';

create function public.os_notification_schema_version() returns integer
language sql stable security invoker set search_path = public, pg_temp as $$ select 1 $$;
revoke all on function public.os_notification_schema_version() from public, anon, authenticated;
grant execute on function public.os_notification_schema_version() to service_role;

create function public.os_notification_guard() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if old.record_type = 'notification' then raise exception using errcode='23514', message='NOTIFICATION_IMMUTABLE'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and (old.record_type = 'notification' or new.record_type = 'notification') then
    if old.record_type <> new.record_type
      or (to_jsonb(new) - array['status','metadata','updated_by','updated_at','version']) is distinct from
         (to_jsonb(old) - array['status','metadata','updated_by','updated_at','version'])
      or (new.metadata - 'readAt') is distinct from (old.metadata - 'readAt') then
      raise exception using errcode='23514', message='NOTIFICATION_IMMUTABLE';
    end if;
  end if;
  if new.record_type <> 'notification' then return new; end if;
  if new.title <> '업무 알림' or new.description <> '' or new.status not in ('read','unread')
    or new.owner_id is null or new.owner_id = new.created_by
    or not exists(select 1 from public.os_profiles where id=new.owner_id and is_active)
    or coalesce(new.metadata->>'sourceType','') not in ('record','document')
    or coalesce(new.metadata->>'sourceId','') !~ '^[0-9a-f-]{36}$'
    or coalesce(new.metadata->>'reason','') not in ('assignment','review','approval','blocked','status_change')
    or coalesce(new.metadata->>'dedupeKey','') = ''
    or jsonb_typeof(new.metadata) <> 'object'
    or exists(select 1 from jsonb_each(new.metadata) item where item.key not in ('sourceType','sourceId','reason','readAt','dedupeKey') or jsonb_typeof(item.value) <> 'string')
    or (new.status='read' and coalesce(new.metadata->>'readAt','')='') then
    raise exception using errcode='23514', message='NOTIFICATION_INVALID';
  end if;
  return new;
end $$;
create trigger os_notification_guard_trigger before insert or update or delete on public.os_records
for each row execute function public.os_notification_guard();

create function public.os_enqueue_work_notification(recipient uuid, actor uuid, source_type text, source_id uuid, reason text, source_version text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if recipient is null or actor is null or recipient = actor
    or not exists(select 1 from public.os_profiles where id=recipient and is_active) then return; end if;
  insert into public.os_records(record_type,title,description,status,owner_id,created_by,updated_by,metadata)
  values('notification','업무 알림','','unread',recipient,actor,actor,
    jsonb_build_object('sourceType',source_type,'sourceId',source_id::text,'reason',reason,'readAt','',
      'dedupeKey',source_type||':'||source_id::text||':'||source_version||':'||reason||':'||recipient::text)) on conflict do nothing;
end $$;
revoke all on function public.os_enqueue_work_notification(uuid,uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.os_enqueue_work_notification(uuid,uuid,text,uuid,text,text) to service_role;

create function public.os_work_notifications_after_record() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := coalesce(auth.uid(),new.updated_by,new.created_by); changed boolean; assigned boolean;
begin
  if new.archived_at is not null or new.record_type not in ('task','ai_job','leave_request','content_publish','decision')
    or new.metadata->>'origin' in ('test','market') then return new; end if;
  changed := tg_op='INSERT'; assigned := tg_op='INSERT' and new.assignee_id is not null;
  if tg_op='UPDATE' then changed := new.status is distinct from old.status; assigned := new.assignee_id is distinct from old.assignee_id; end if;
  if new.metadata->>'kind'='development_request' then
    -- Assignment and mention delivery for development requests remain on the old type.
    if tg_op='UPDATE' and changed then
      perform public.os_enqueue_work_notification(new.created_by,actor,'record',new.id,'status_change',new.version::text);
    end if;
    return new;
  end if;
  if new.status in ('review','pending_approval','approval','ready') and (changed or assigned) then
    perform public.os_enqueue_work_notification(new.assignee_id,actor,'record',new.id,
      case when new.status='review' then 'review' else 'approval' end,new.version::text);
  elsif assigned then
    perform public.os_enqueue_work_notification(new.assignee_id,actor,'record',new.id,'assignment',new.version::text);
  end if;
  if new.record_type='ai_job' and new.status in ('blocked','failed') and changed then
    perform public.os_enqueue_work_notification(coalesce(new.assignee_id,new.owner_id),actor,'record',new.id,'blocked',new.version::text);
  end if;
  return new;
end $$;
revoke all on function public.os_work_notifications_after_record() from public,anon,authenticated;
create trigger os_work_notifications_record_trigger after insert or update on public.os_records
for each row execute function public.os_work_notifications_after_record();

create function public.os_work_notifications_after_document() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare recipient uuid; actor uuid := auth.uid();
begin
  if actor is null and nullif(current_setting('os.agent_key_id',true),'') is not null then
    select owner_user_id into actor from public.os_agent_keys where id::text=current_setting('os.agent_key_id',true);
  end if;
  -- Do not invent the actor for service writes without an authenticated identity.
  if actor is null then return new; end if;
  if tg_op='UPDATE' and old.status = new.status then return new; end if;
  if new.status='review' then
    -- Routing alerts to existing administrators grants no review/approval authority.
    for recipient in select id from public.os_profiles where is_active and role='admin' loop
      perform public.os_enqueue_work_notification(recipient,actor,'document',new.id,'review',new.updated_at::text);
    end loop;
  elsif new.status='reviewed' then
    perform public.os_enqueue_work_notification(new.owner_id,actor,'document',new.id,'approval',new.updated_at::text);
  end if;
  return new;
end $$;
revoke all on function public.os_work_notifications_after_document() from public,anon,authenticated;
create trigger os_work_notifications_document_trigger after insert or update on public.os_documents
for each row execute function public.os_work_notifications_after_document();

-- Notification delivery/read state must not copy recipient metadata into the
-- broadly readable operating-record audit stream. Other record history is unchanged.
CREATE OR REPLACE FUNCTION "public"."os_records_after_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_changed text[] := '{}';
begin
  if new.record_type = 'notification' then return new; end if;
  if tg_op = 'INSERT' then
    insert into public.os_record_events (
      record_id, actor_id, event_type, to_status, snapshot
    ) values (
      new.id, new.created_by, 'created', new.status, to_jsonb(new)
    );
  else
    if old.title is distinct from new.title then v_changed := array_append(v_changed, 'title'); end if;
    if old.description is distinct from new.description then v_changed := array_append(v_changed, 'description'); end if;
    if old.status is distinct from new.status then v_changed := array_append(v_changed, 'status'); end if;
    if old.assignee_id is distinct from new.assignee_id then v_changed := array_append(v_changed, 'assignee_id'); end if;
    if old.due_date is distinct from new.due_date then v_changed := array_append(v_changed, 'due_date'); end if;
    if old.progress is distinct from new.progress then v_changed := array_append(v_changed, 'progress'); end if;
    if old.metric_current is distinct from new.metric_current then v_changed := array_append(v_changed, 'metric_current'); end if;
    if old.archived_at is distinct from new.archived_at then v_changed := array_append(v_changed, 'archived_at'); end if;
    insert into public.os_record_events (
      record_id, actor_id, event_type, from_status, to_status, changed_fields, snapshot
    ) values (
      new.id, new.updated_by,
      case when new.archived_at is not null and old.archived_at is null then 'archived' else 'updated' end,
      old.status, new.status, v_changed, to_jsonb(new)
    );
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."os_records_after_write"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."os_development_request_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
declare
  new_request boolean := coalesce(new.metadata->>'kind', '') = 'development_request';
  old_request boolean := false;
  management_keys text[] := array['resolution', 'branch', 'commitSha', 'prUrl', 'deploymentUrl', 'plainSummary', 'nextAction', 'holdReason', 'reviewDate'];
  editable_metadata text[] := array['pageUrl', 'category', 'expectedResult', 'attachmentUrl', 'attachmentPath', 'attachmentName', 'attachmentSize', 'attachmentType'];
  metadata_key text;
  metadata_value text;
  only_reopen boolean;
begin
  if tg_op = 'UPDATE' then old_request := coalesce(old.metadata->>'kind', '') = 'development_request'; end if;
  if not old_request and not new_request then return new; end if;
  if not new_request or new.record_type <> 'ai_job' or (tg_op = 'UPDATE' and not old_request) then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_KIND_IMMUTABLE';
  end if;
  if new.status not in ('backlog', 'active', 'review', 'done', 'blocked') then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_STATUS_INVALID';
  end if;
  if jsonb_typeof(new.metadata) <> 'object' or exists (
    select 1 from jsonb_each(new.metadata) item
    where item.key <> all(array['kind','pageUrl','category','steps','expectedResult','attachmentUrl','attachmentPath','attachmentName','attachmentSize','attachmentType','resolution','branch','commitSha','prUrl','deploymentUrl','plainSummary','nextAction','holdReason','reviewDate'])
      or jsonb_typeof(item.value) <> 'string'
  ) then raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_METADATA_INVALID'; end if;
  if coalesce(new.metadata->>'category', '') not in ('bug','usability','feature','question') then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_CATEGORY_INVALID';
  end if;
  if char_length(coalesce(new.metadata->>'steps','')) > 8000
    or char_length(coalesce(new.metadata->>'expectedResult','')) > 8000
    or char_length(coalesce(new.metadata->>'attachmentName','')) > 240
    or char_length(coalesce(new.metadata->>'attachmentType','')) > 160
    or coalesce(new.metadata->>'attachmentSize','') !~ '^$|^[1-9][0-9]{0,8}$'
    or (coalesce(new.metadata->>'attachmentPath','') <> '' and new.metadata->>'attachmentPath' !~ '^requests/[0-9a-f-]{36}/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f-]{36}\.(jpg|png|webp|gif|mp4|mov|webm|pdf|txt|csv|doc|docx|ppt|pptx|xls|xlsx|zip)$')
    or char_length(coalesce(new.metadata->>'resolution','')) > 12000
    or char_length(coalesce(new.metadata->>'plainSummary','')) > 240
    or char_length(coalesce(new.metadata->>'nextAction','')) > 500
    or char_length(coalesce(new.metadata->>'holdReason','')) > 2000
    or coalesce(new.metadata->>'reviewDate','') !~ '^$|^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or char_length(coalesce(new.metadata->>'branch','')) > 300
    or (coalesce(new.metadata->>'commitSha','') <> '' and new.metadata->>'commitSha' !~ '^[a-fA-F0-9]{7,64}$') then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_METADATA_TOO_LONG';
  end if;
  foreach metadata_key in array array['pageUrl','attachmentUrl','prUrl','deploymentUrl'] loop
    metadata_value := coalesce(new.metadata->>metadata_key, '');
    if char_length(metadata_value) > 2000 then raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_URL_INVALID'; end if;
    if metadata_value <> '' then
      if metadata_key = 'pageUrl' and metadata_value ~ '^/($|[^/\\[:space:]])' and metadata_value !~ '[\\[:space:]]' then continue; end if;
      if metadata_value !~ '^https?://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$' then raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_URL_INVALID'; end if;
    end if;
  end loop;
  if new.status = 'done' and btrim(coalesce(new.metadata->>'resolution','')) = '' then raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_RESOLUTION_REQUIRED'; end if;
  if new.parent_id is not null and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) and not exists (
    select 1 from public.os_records where id = new.parent_id and record_type = 'project' and archived_at is null
  ) then raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_PROJECT_INVALID'; end if;
  if auth.uid() is null or public.os_is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'backlog' or new.created_by <> auth.uid() or new.owner_id is distinct from auth.uid() or new.assignee_id is not null or new.archived_at is not null or new.metadata ?| management_keys then
      raise exception using errcode = '42501', message = 'DEVELOPMENT_REQUEST_REPORTER_INSERT_FORBIDDEN';
    end if;
    return new;
  end if;
  if old.created_by <> auth.uid() then raise exception using errcode = '42501', message = 'DEVELOPMENT_REQUEST_OWNER_REQUIRED'; end if;
  only_reopen := old.status in ('done','review') and new.status = 'backlog'
    and (to_jsonb(new) - array['status','updated_by','updated_at','version']) = (to_jsonb(old) - array['status','updated_by','updated_at','version']);
  if only_reopen then return new; end if;
  if old.status <> 'backlog' or new.status <> 'backlog'
    or (to_jsonb(new) - array['title','description','priority','parent_id','metadata','updated_by','updated_at','version']) is distinct from (to_jsonb(old) - array['title','description','priority','parent_id','metadata','updated_by','updated_at','version'])
    or (new.metadata - editable_metadata) is distinct from (old.metadata - editable_metadata) then
    raise exception using errcode = '42501', message = 'DEVELOPMENT_REQUEST_REPORTER_UPDATE_FORBIDDEN';
  end if;
  return new;
end;
$_$;


ALTER FUNCTION "public"."os_development_request_guard"() OWNER TO "postgres";

commit;
