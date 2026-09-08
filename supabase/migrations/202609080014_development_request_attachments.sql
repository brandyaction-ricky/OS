begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'os-development-attachments', 'os-development-attachments', false, 26214400,
  array[
    'image/jpeg','image/png','image/webp','image/gif',
    'video/mp4','video/quicktime','video/webm',
    'application/pdf','text/plain','text/csv','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/zip'
  ]
)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.os_development_request_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  new_request boolean := coalesce(new.metadata->>'kind', '') = 'development_request';
  old_request boolean := false;
  management_keys text[] := array['resolution', 'branch', 'commitSha', 'prUrl', 'deploymentUrl'];
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
    where item.key <> all(array['kind','pageUrl','category','steps','expectedResult','attachmentUrl','attachmentPath','attachmentName','attachmentSize','attachmentType','resolution','branch','commitSha','prUrl','deploymentUrl'])
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
$$;

commit;
