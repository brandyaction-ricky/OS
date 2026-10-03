begin;
-- Existing keys keep their exact effective write policy; only newly issued keys opt in.
alter table public.os_agent_keys add column enforce_write_statuses boolean not null default false;
comment on column public.os_agent_keys.enforce_write_statuses is 'New keys enforce allowed_statuses on document writes; legacy keys retain their prior behavior.';
CREATE OR REPLACE FUNCTION "public"."os_agent_archive_document"("p_agent_key_id" "uuid", "p_organization_id" "uuid", "p_document_id" "uuid", "p_reason" "text" DEFAULT ''::"text") RETURNS "public"."os_documents"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  k public.os_agent_keys;
  d public.os_documents;
  v_from public.os_doc_status;
begin
  k := public.os_assert_agent_write_access(p_agent_key_id, p_organization_id, 'knowledge.delete');
  select * into d from public.os_documents where id = p_document_id for update;
  if not found then raise exception 'OS_DOC_NOT_FOUND' using errcode = 'P0002'; end if;
  if d.owner_id <> k.owner_user_id and d.status <> 'canonical' then
    raise exception 'OS_AGENT_DOCUMENT_DENIED' using errcode = 'P0001';
  end if;
  if d.status = 'archived' then return d; end if;
  if k.enforce_write_statuses and not (d.status = any(k.allowed_statuses)) then raise exception 'OS_AGENT_DOCUMENT_DENIED' using errcode = 'P0001'; end if;

  v_from := d.status;
  perform set_config('os.status_change_ok', '1', true);
  perform set_config('os.agent_key_id', p_agent_key_id::text, true);
  update public.os_documents set status = 'archived' where id = p_document_id returning * into d;
  perform set_config('os.status_change_ok', '', true);

  insert into public.os_document_events (document_id, from_status, to_status, actor_id, note)
  values (
    p_document_id, v_from, 'archived', k.owner_user_id,
    concat('MCP 에이전트 ', k.name, ': ', coalesce(p_reason, '휴지통 이동'))
  );
  insert into public.os_agent_audit_logs (
    organization_id, agent_key_id, owner_user_id, action, document_id,
    title_snapshot, changed_fields, reason
  ) values (
    p_organization_id, p_agent_key_id, k.owner_user_id, 'knowledge.delete', d.id,
    d.title, array['status'], coalesce(p_reason, '휴지통 이동')
  );
  return d;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."os_agent_create_document"("p_agent_key_id" "uuid", "p_organization_id" "uuid", "p_title" "text", "p_content_md" "text", "p_folder" "text" DEFAULT 'AI 저장/검토 대기'::"text", "p_brand" "text" DEFAULT ''::"text", "p_team" "text" DEFAULT ''::"text", "p_tags" "text"[] DEFAULT '{}'::"text"[], "p_reason" "text" DEFAULT ''::"text") RETURNS "public"."os_documents"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  k public.os_agent_keys;
  d public.os_documents;
begin
  k := public.os_assert_agent_write_access(p_agent_key_id, p_organization_id, 'knowledge.create');
  if k.enforce_write_statuses and not ('draft'::public.os_doc_status = any(k.allowed_statuses)) then raise exception 'OS_AGENT_DOCUMENT_DENIED' using errcode = 'P0001'; end if;
  if char_length(trim(p_title)) < 1 or char_length(p_content_md) < 1 then
    raise exception 'OS_AGENT_DOCUMENT_INVALID' using errcode = 'P0001';
  end if;

  perform set_config('os.agent_key_id', p_agent_key_id::text, true);
  insert into public.os_documents (
    title, content_md, folder, brand, team, tags, source, status, owner_id, created_by
  ) values (
    trim(p_title), p_content_md, coalesce(p_folder, 'AI 저장/검토 대기'),
    coalesce(p_brand, k.brand, ''), coalesce(nullif(p_team, ''), k.team, ''),
    coalesce(p_tags, '{}'), 'mcp', 'draft', k.owner_user_id, k.owner_user_id
  ) returning * into d;

  update public.os_document_versions
  set agent_key_id = p_agent_key_id
  where document_id = d.id and version_no = d.current_version;

  update public.os_document_events
  set actor_id = k.owner_user_id, note = concat('MCP 에이전트 ', k.name, ': 생성')
  where document_id = d.id and actor_id is null and note = 'created';

  insert into public.os_agent_audit_logs (
    organization_id, agent_key_id, owner_user_id, action, document_id,
    title_snapshot, changed_fields, reason
  ) values (
    p_organization_id, p_agent_key_id, k.owner_user_id, 'knowledge.create', d.id,
    d.title, array['title', 'content_md', 'folder', 'tags'], coalesce(p_reason, '')
  );
  return d;
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
  if k.enforce_write_statuses and not (d.status = any(k.allowed_statuses)) then raise exception 'OS_AGENT_DOCUMENT_DENIED' using errcode = 'P0001'; end if;
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
revoke all on function public.os_agent_create_document(uuid,uuid,text,text,text,text,text,text[],text) from public, anon, authenticated;
revoke all on function public.os_agent_update_document(uuid,uuid,uuid,integer,text,text,text,text,text,text[],text[],text) from public, anon, authenticated;
revoke all on function public.os_agent_archive_document(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.os_agent_create_document(uuid,uuid,text,text,text,text,text,text[],text) to service_role;
grant execute on function public.os_agent_update_document(uuid,uuid,uuid,integer,text,text,text,text,text,text[],text[],text) to service_role;
grant execute on function public.os_agent_archive_document(uuid,uuid,uuid,text) to service_role;
commit;
