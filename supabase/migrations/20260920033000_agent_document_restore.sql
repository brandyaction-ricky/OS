begin;

alter table public.os_agent_audit_logs
  drop constraint if exists os_agent_audit_logs_action_check;
alter table public.os_agent_audit_logs
  add constraint os_agent_audit_logs_action_check
  check (action in ('knowledge.create', 'knowledge.update', 'knowledge.delete', 'knowledge.restore'));

create or replace function public.os_agent_update_document(
  p_agent_key_id uuid, p_organization_id uuid, p_document_id uuid,
  p_expected_version integer, p_title text, p_content_md text, p_folder text,
  p_brand text, p_team text, p_tags text[], p_changed_fields text[], p_reason text default ''
) returns public.os_documents
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  k public.os_agent_keys;
  d public.os_documents;
begin
  k := public.os_assert_agent_write_access(p_agent_key_id, p_organization_id, 'knowledge.update');
  select * into d from public.os_documents where id = p_document_id for update;
  if not found then raise exception 'OS_DOC_NOT_FOUND' using errcode = 'P0002'; end if;
  if d.status = 'archived' then raise exception 'OS_AGENT_ARCHIVED_READ_ONLY' using errcode = 'P0001'; end if;
  if not (d.status = any(k.allowed_statuses)) then raise exception 'OS_AGENT_DOCUMENT_DENIED' using errcode = 'P0001'; end if;
  if d.current_version <> p_expected_version then raise exception 'OS_VERSION_CONFLICT:%', d.current_version using errcode = 'P0001'; end if;

  perform set_config('os.version_reason', coalesce(nullif(p_reason, ''), 'MCP 에이전트 수정'), true);
  perform set_config('os.agent_key_id', p_agent_key_id::text, true);
  update public.os_documents
  set title = p_title, content_md = p_content_md, folder = p_folder,
      brand = p_brand, team = p_team, tags = coalesce(p_tags, '{}')
  where id = p_document_id returning * into d;
  update public.os_document_versions set agent_key_id = p_agent_key_id
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

revoke all on function public.os_agent_update_document(uuid, uuid, uuid, integer, text, text, text, text, text, text[], text[], text) from public, anon, authenticated;
grant execute on function public.os_agent_update_document(uuid, uuid, uuid, integer, text, text, text, text, text, text[], text[], text) to service_role;

create or replace function public.os_agent_restore_document(
  p_agent_key_id uuid,
  p_organization_id uuid,
  p_document_id uuid,
  p_expected_version integer,
  p_reason text default ''
) returns public.os_documents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  k public.os_agent_keys;
  d public.os_documents;
  v_restore_status public.os_doc_status;
begin
  k := public.os_assert_agent_write_access(p_agent_key_id, p_organization_id, 'knowledge.update');
  select * into d from public.os_documents where id = p_document_id for update;
  if not found then raise exception 'OS_DOC_NOT_FOUND' using errcode = 'P0002'; end if;
  if d.status <> 'archived' then return d; end if;
  if d.current_version <> p_expected_version then
    raise exception 'OS_VERSION_CONFLICT:%', d.current_version using errcode = 'P0001';
  end if;

  select from_status into v_restore_status
  from public.os_document_events
  where document_id = p_document_id and to_status = 'archived'
  order by created_at desc limit 1;
  v_restore_status := coalesce(v_restore_status, 'draft'::public.os_doc_status);
  if not (v_restore_status = any(k.allowed_statuses)) then
    raise exception 'OS_AGENT_DOCUMENT_DENIED' using errcode = 'P0001';
  end if;

  perform set_config('os.agent_key_id', p_agent_key_id::text, true);
  perform set_config('os.version_reason', coalesce(nullif(p_reason, ''), 'MCP 에이전트 휴지통 복원'), true);
  perform set_config('os.status_change_ok', '1', true);
  update public.os_documents set status = v_restore_status where id = p_document_id returning * into d;
  perform set_config('os.status_change_ok', '', true);

  insert into public.os_document_events (document_id, from_status, to_status, actor_id, note)
  values (d.id, 'archived', v_restore_status, k.owner_user_id, coalesce(p_reason, 'MCP 에이전트 휴지통 복원'));

  insert into public.os_agent_audit_logs (
    organization_id, agent_key_id, owner_user_id, action, document_id,
    title_snapshot, changed_fields, reason
  ) values (
    p_organization_id, p_agent_key_id, k.owner_user_id, 'knowledge.restore', d.id,
    d.title, array['status'], coalesce(p_reason, '')
  );
  return d;
end;
$$;

revoke all on function public.os_agent_restore_document(uuid, uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.os_agent_restore_document(uuid, uuid, uuid, integer, text) to service_role;

commit;
