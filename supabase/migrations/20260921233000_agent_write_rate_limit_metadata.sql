create table if not exists public.os_agent_write_rate_limits (
  bucket text primary key check (bucket in ('knowledge.create', 'knowledge.update', 'knowledge.move', 'knowledge.delete')),
  minute_limit integer not null check (minute_limit > 0),
  day_limit integer not null check (day_limit > 0),
  note text not null default '',
  updated_at timestamptz not null default now()
);

comment on table public.os_agent_write_rate_limits is
  'Service-only configuration for agent knowledge write limits. Defaults preserve the previously deployed limits.';

alter table public.os_agent_write_rate_limits enable row level security;
revoke all on table public.os_agent_write_rate_limits from public, anon, authenticated;
grant select, insert, update on table public.os_agent_write_rate_limits to service_role;

create index if not exists os_agent_audit_logs_key_action_created_idx
  on public.os_agent_audit_logs (agent_key_id, action, created_at desc);

create or replace function public.os_assert_agent_write_access(
  p_agent_key_id uuid,
  p_organization_id uuid,
  p_action text
) returns public.os_agent_keys
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  k public.os_agent_keys;
  v_minute_limit integer;
  v_day_limit integer;
  v_minute_count integer;
  v_day_count integer;
  v_minute_reset_at timestamptz;
  v_day_reset_at timestamptz;
  v_reset_at timestamptz;
  v_retry_after integer;
begin
  select * into k
  from public.os_agent_keys
  where id = p_agent_key_id
    and organization_id = p_organization_id
    and active
    and 'knowledge.write' = any(scopes)
    and (expires_at is null or expires_at > now())
  for update;

  if not found then
    raise exception 'OS_AGENT_WRITE_DENIED' using errcode = 'P0001';
  end if;

  if p_action not in ('knowledge.create', 'knowledge.update', 'knowledge.move', 'knowledge.delete') then
    raise exception 'OS_AGENT_WRITE_POLICY_MISSING' using errcode = 'P0001';
  end if;

  select
    coalesce(
      (select minute_limit from public.os_agent_write_rate_limits where bucket = p_action),
      case when p_action = 'knowledge.delete' then 5 else 20 end
    ),
    coalesce(
      (select day_limit from public.os_agent_write_rate_limits where bucket = p_action),
      case
        when p_action = 'knowledge.delete' then 30
        when p_action = 'knowledge.update' then 1000
        else 200
      end
    )
  into v_minute_limit, v_day_limit;

  select
    count(*) filter (where created_at >= now() - interval '1 minute'),
    count(*),
    min(created_at) filter (where created_at >= now() - interval '1 minute') + interval '1 minute',
    min(created_at) + interval '24 hours'
  into v_minute_count, v_day_count, v_minute_reset_at, v_day_reset_at
  from public.os_agent_audit_logs
  where agent_key_id = p_agent_key_id
    and created_at >= now() - interval '24 hours'
    and (
      (p_action = 'knowledge.move' and action = 'knowledge.update' and changed_fields <@ array['folder']::text[])
      or (p_action = 'knowledge.update' and action = 'knowledge.update' and not (changed_fields <@ array['folder']::text[]))
      or (p_action in ('knowledge.create', 'knowledge.delete') and action = p_action)
    );

  if v_minute_count >= v_minute_limit or v_day_count >= v_day_limit then
    v_reset_at := greatest(
      case when v_minute_count >= v_minute_limit then v_minute_reset_at end,
      case when v_day_count >= v_day_limit then v_day_reset_at end
    );
    v_retry_after := greatest(1, ceil(extract(epoch from (v_reset_at - now())))::integer);
    raise exception 'OS_AGENT_RATE_LIMITED:%', json_build_object(
      'bucket', p_action,
      'minuteLimit', v_minute_limit,
      'minuteUsed', v_minute_count,
      'dayLimit', v_day_limit,
      'dayUsed', v_day_count,
      'retryAfterSeconds', v_retry_after,
      'resetAt', v_reset_at
    )::text using errcode = 'P0001';
  end if;

  return k;
end;
$$;

create or replace function public.os_agent_update_document(
  p_agent_key_id uuid,
  p_organization_id uuid,
  p_document_id uuid,
  p_expected_version integer,
  p_title text,
  p_content_md text,
  p_folder text,
  p_brand text,
  p_team text,
  p_tags text[],
  p_changed_fields text[],
  p_reason text default ''
) returns public.os_documents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  k public.os_agent_keys;
  d public.os_documents;
  v_action text := case
    when coalesce(p_changed_fields, '{}') <@ array['folder']::text[] then 'knowledge.move'
    else 'knowledge.update'
  end;
begin
  k := public.os_assert_agent_write_access(p_agent_key_id, p_organization_id, v_action);
  select * into d from public.os_documents where id = p_document_id for update;
  if not found then raise exception 'OS_DOC_NOT_FOUND' using errcode = 'P0002'; end if;
  if d.status = 'archived' then raise exception 'OS_AGENT_ARCHIVED_READ_ONLY' using errcode = 'P0001'; end if;
  if d.owner_id <> k.owner_user_id and d.status <> 'canonical' then
    raise exception 'OS_AGENT_DOCUMENT_DENIED' using errcode = 'P0001';
  end if;
  if d.current_version <> p_expected_version then
    raise exception 'OS_VERSION_CONFLICT:%', d.current_version using errcode = 'P0001';
  end if;

  perform set_config('os.version_reason', coalesce(nullif(p_reason, ''), 'MCP 에이전트 수정'), true);
  perform set_config('os.agent_key_id', p_agent_key_id::text, true);
  update public.os_documents
  set title = p_title, content_md = p_content_md, folder = p_folder,
      brand = p_brand, team = p_team, tags = coalesce(p_tags, '{}')
  where id = p_document_id
  returning * into d;

  update public.os_document_versions
  set agent_key_id = p_agent_key_id
  where document_id = d.id and version_no = d.current_version;

  insert into public.os_agent_audit_logs (
    organization_id, agent_key_id, owner_user_id, action, document_id,
    title_snapshot, changed_fields, reason
  ) values (
    p_organization_id, p_agent_key_id, k.owner_user_id, 'knowledge.update', d.id,
    d.title, coalesce(p_changed_fields, '{}'), coalesce(p_reason, '')
  );
  return d;
end;
$$;

revoke all on function public.os_assert_agent_write_access(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.os_agent_update_document(uuid, uuid, uuid, integer, text, text, text, text, text, text[], text[], text) from public, anon, authenticated;
grant execute on function public.os_assert_agent_write_access(uuid, uuid, text) to service_role;
grant execute on function public.os_agent_update_document(uuid, uuid, uuid, integer, text, text, text, text, text, text[], text[], text) to service_role;
