-- 대표 2026-11-04: the designated approver's AI key edits the approver's own team / review documents in place (a version and the
-- agent audit row are kept as for drafts), so a shared document no longer goes back to 내 노트 first. Other keys, other people's
-- documents, notes, 정본 and status changes keep their rules. Both functions are replaced whole; privileges stay as granted.
-- Manual undo: supabase/rollback/20261104120000_approver_agent_shared_document_edit.down.sql
begin;
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
  -- 대표 2026-11-04: the designated approver's key edits the approver's own shared (team · review) document in place;
  -- os_workspace_guard_document lets exactly that update through. Other keys and documents keep the draft-only rule.
  if d.status in ('team', 'review', 'reviewed') and d.owner_id = k.owner_user_id and exists (
    select 1 from public.os_approval_assignments a
    where a.user_id = k.owner_user_id and a.kind = 'approver' and a.revoked_at is null
      and (a.starts_on is null or a.starts_on <= current_date) and (a.ends_on is null or a.ends_on >= current_date)
  ) then
    perform set_config('os.agent_shared_edit_ok', '1', true);
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
  perform set_config('os.agent_shared_edit_ok', '', true);

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

create or replace function public.os_workspace_guard_document() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.os_doc_categories;
begin
  if ((tg_op='INSERT' and new.meeting_record_id is not null) or (tg_op='UPDATE' and (old.meeting_record_id is not null or new.meeting_record_id is distinct from old.meeting_record_id)))
    and current_setting('os.workspace_meeting_ok',true) is distinct from '1' then
    raise exception 'OS_MEETING_COMMAND_REQUIRED' using errcode='42501';
  end if;
  if tg_op='UPDATE' then
    if coalesce(current_setting('os.agent_key_id',true),'')<>'' and (old.source not in ('mcp','obsidian_vault') or old.status<>'draft' or new.status<>'draft')
      and not (current_setting('os.agent_shared_edit_ok',true)='1' and old.status in ('team','review','reviewed') and new.status=old.status) then
      raise exception 'OS_AGENT_DOCUMENT_DENIED' using errcode='42501';
    end if;
    if auth.uid() is not null and old.status='draft' and old.owner_id<>auth.uid() then raise exception 'OS_NOTE_AUDIT_READ_ONLY' using errcode='42501'; end if;
    if old.status='canonical' and (new.title,new.content_md,new.folder,new.tags,new.brand,new.team,new.review_due_on) is distinct from (old.title,old.content_md,old.folder,old.tags,old.brand,old.team,old.review_due_on)
      and current_setting('os.proposal_apply_ok',true) is distinct from '1' and current_setting('os.review_keep_ok',true) is distinct from '1' then
      raise exception 'OS_CANONICAL_PROPOSAL_REQUIRED' using errcode='42501';
    end if;
    if auth.uid() is not null and new.owner_id is distinct from old.owner_id and not public.os_is_admin() then raise exception 'OS_OWNER_ADMIN_REQUIRED' using errcode='42501'; end if;
    if auth.uid() is not null and not public.os_workspace_page_read(old.id) then raise exception 'OS_DOCUMENT_ACCESS_DENIED' using errcode='42501'; end if;
    if public.os_is_partner() and old.status<>'draft' and (new.category_id,new.owner_id,new.folder,new.tags,new.status) is distinct from (old.category_id,old.owner_id,old.folder,old.tags,old.status) then raise exception 'OS_PARTNER_PROPERTY_DENIED' using errcode='42501'; end if;
    if new.retention_hold is distinct from old.retention_hold and auth.uid() is not null and not public.os_is_admin()
      and current_setting('os.status_change_ok',true) is distinct from '1'
      and not (coalesce(current_setting('os.workspace_meeting_ok',true),'')='1' and new.retention_hold and new.meeting_record_id is not null)
      then raise exception 'OS_RETENTION_ADMIN_REQUIRED' using errcode='42501'; end if;
  elsif auth.uid() is not null then
    if new.owner_id<>auth.uid() or (new.status<>'draft' and (new.status<>'team' or (public.os_is_partner() and current_setting('os.workspace_meeting_ok',true) is distinct from '1'))) then raise exception 'OS_DOCUMENT_CREATE_DENIED' using errcode='42501'; end if;
  end if;
  if new.category_id is not null then
    select * into c from public.os_doc_categories where id=new.category_id and archived_at is null;
    if not found or (new.status='draft' and (c.space<>'mine' or c.owner_id<>new.owner_id)) or (new.status<>'draft' and new.status<>'archived' and c.space<>'team') then raise exception 'OS_CATEGORY_SPACE_MISMATCH' using errcode='23514'; end if;
  end if;
  return new;
end $$;
commit;
