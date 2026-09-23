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
  'development_log', 'deployment', 'development_comment',
  'content_topic', 'content_script', 'content_package', 'content_short',
  'content_publish', 'content_metric', 'skill', 'knowledge_link',
  'revenue', 'funnel', 'crm_action', 'customer', 'brand',
  'connection', 'access_rule', 'company_setting', 'channel',
  'leave_balance', 'leave_request', 'expense', 'contract', 'subscription', 'company_document'
));

create index if not exists os_records_development_comment_idx
  on public.os_records(parent_id, created_at, id)
  where archived_at is null and record_type = 'development_comment';

create or replace function public.os_development_comment_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  reply_id uuid;
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
    or exists (
      select 1 from jsonb_each(new.metadata) item
      where item.key <> all(array['kind', 'requestId', 'replyTo', 'authorName', 'authorType'])
        or jsonb_typeof(item.value) <> 'string'
    ) then
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

drop trigger if exists os_development_comment_guard_trigger on public.os_records;
create trigger os_development_comment_guard_trigger
before insert or update or delete on public.os_records
for each row execute function public.os_development_comment_guard();

commit;
