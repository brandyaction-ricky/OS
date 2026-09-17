begin;

-- Development operations are stored as first-class records so ChatGPT Work and
-- the OS UI can share one auditable project history.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.os_records'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%record_type%'
  loop
    execute format('alter table public.os_records drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table public.os_records add constraint os_records_record_type_check check (record_type in (
  'project', 'task', 'goal', 'kpi', 'decision', 'meeting', 'ai_job',
  'development_log', 'deployment',
  'content_topic', 'content_script', 'content_package', 'content_short',
  'content_publish', 'content_metric', 'skill', 'knowledge_link',
  'revenue', 'funnel', 'crm_action', 'customer', 'brand',
  'connection', 'access_rule', 'company_setting', 'channel',
  'leave_balance', 'leave_request', 'expense', 'contract', 'subscription', 'company_document'
));

create index if not exists os_records_project_history_idx
  on public.os_records(parent_id, record_type, updated_at desc)
  where archived_at is null and record_type in ('task', 'ai_job', 'decision', 'development_log', 'deployment');

-- Requests reuse ai_job; this guard also covers direct authenticated Data API
-- writes, which otherwise allow reporters to set management fields on own rows.
create or replace function public.os_development_request_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  old_request boolean := false;
  new_request boolean := coalesce(new.metadata->>'kind', '') = 'development_request';
  management_keys text[] := array['resolution', 'branch', 'commitSha', 'prUrl', 'deploymentUrl'];
  editable_metadata text[] := array['pageUrl', 'category', 'steps', 'expectedResult', 'attachmentUrl'];
  metadata_key text;
  metadata_value text;
  only_reopen boolean;
begin
  if tg_op = 'UPDATE' then
    old_request := coalesce(old.metadata->>'kind', '') = 'development_request';
  end if;
  if not old_request and not new_request then return new; end if;

  if not new_request or new.record_type <> 'ai_job'
    or (tg_op = 'UPDATE' and not old_request) then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_KIND_IMMUTABLE';
  end if;
  if new.status not in ('backlog', 'active', 'review', 'done', 'blocked') then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_STATUS_INVALID';
  end if;
  if jsonb_typeof(new.metadata) <> 'object' or exists (
    select 1 from jsonb_each(new.metadata) item
    where item.key <> all(array['kind', 'pageUrl', 'category', 'steps', 'expectedResult', 'attachmentUrl', 'resolution', 'branch', 'commitSha', 'prUrl', 'deploymentUrl'])
      or jsonb_typeof(item.value) <> 'string'
  ) then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_METADATA_INVALID';
  end if;
  if coalesce(new.metadata->>'category', '') not in ('bug', 'usability', 'feature', 'question') then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_CATEGORY_INVALID';
  end if;
  if char_length(coalesce(new.metadata->>'steps', '')) > 8000
    or char_length(coalesce(new.metadata->>'expectedResult', '')) > 8000
    or char_length(coalesce(new.metadata->>'resolution', '')) > 12000
    or char_length(coalesce(new.metadata->>'branch', '')) > 300
    or (coalesce(new.metadata->>'commitSha', '') <> '' and new.metadata->>'commitSha' !~ '^[a-fA-F0-9]{7,64}$') then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_METADATA_TOO_LONG';
  end if;
  foreach metadata_key in array array['pageUrl', 'attachmentUrl', 'prUrl', 'deploymentUrl'] loop
    metadata_value := coalesce(new.metadata->>metadata_key, '');
    if char_length(metadata_value) > 2000 then
      raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_URL_INVALID';
    end if;
    if metadata_value <> '' then
      if metadata_key = 'pageUrl' and metadata_value ~ '^/($|[^/\\[:space:]])' and metadata_value !~ '[\\[:space:]]' then
        continue;
      end if;
      if metadata_value !~ '^https?://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$' then
        raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_URL_INVALID';
      end if;
    end if;
  end loop;
  if new.status = 'done' and btrim(coalesce(new.metadata->>'resolution', '')) = '' then
    raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_RESOLUTION_REQUIRED';
  end if;
  if new.parent_id is not null and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then
    if not exists (select 1 from public.os_records where id = new.parent_id and record_type = 'project' and archived_at is null) then
      raise exception using errcode = '23514', message = 'DEVELOPMENT_REQUEST_PROJECT_INVALID';
    end if;
  end if;

  -- Service-role maintenance remains privileged. Human writes must obey the
  -- reporter policy in addition to the existing active-member/owner RLS.
  if auth.uid() is null or public.os_is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'backlog' or new.created_by <> auth.uid() or new.owner_id is distinct from auth.uid()
      or new.assignee_id is not null or new.archived_at is not null
      or new.metadata ?| management_keys then
      raise exception using errcode = '42501', message = 'DEVELOPMENT_REQUEST_REPORTER_INSERT_FORBIDDEN';
    end if;
    return new;
  end if;

  if old.created_by <> auth.uid() then
    raise exception using errcode = '42501', message = 'DEVELOPMENT_REQUEST_OWNER_REQUIRED';
  end if;
  only_reopen := old.status in ('done', 'review') and new.status = 'backlog'
    and (to_jsonb(new) - array['status', 'updated_by', 'updated_at', 'version'])
      = (to_jsonb(old) - array['status', 'updated_by', 'updated_at', 'version']);
  if only_reopen then return new; end if;
  if old.status <> 'backlog' or new.status <> 'backlog'
    or (to_jsonb(new) - array['title', 'description', 'priority', 'parent_id', 'metadata', 'updated_by', 'updated_at', 'version'])
      is distinct from (to_jsonb(old) - array['title', 'description', 'priority', 'parent_id', 'metadata', 'updated_by', 'updated_at', 'version'])
    or (new.metadata - editable_metadata) is distinct from (old.metadata - editable_metadata) then
    raise exception using errcode = '42501', message = 'DEVELOPMENT_REQUEST_REPORTER_UPDATE_FORBIDDEN';
  end if;
  return new;
end;
$$;

revoke all on function public.os_development_request_guard() from public, anon, authenticated;
drop trigger if exists os_development_request_guard_trigger on public.os_records;
create trigger os_development_request_guard_trigger
before insert or update on public.os_records
for each row execute function public.os_development_request_guard();

create index if not exists os_records_development_request_inbox_idx
on public.os_records (status, created_at desc, id desc)
where archived_at is null and record_type = 'ai_job' and metadata->>'kind' = 'development_request';

commit;

-- Rollback: drop trigger os_development_request_guard_trigger on public.os_records;
-- drop function public.os_development_request_guard();
-- drop index public.os_records_development_request_inbox_idx;
-- Existing request rows and os_record_events are deliberately preserved.
