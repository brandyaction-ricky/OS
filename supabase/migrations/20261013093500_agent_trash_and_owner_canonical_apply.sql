-- AI keys act with their owner's own permissions for two document actions.
-- 1) Trash: exactly the rule the owner gets when pressing 휴지통 (os_set_document_status 'archived').
-- 2) Canonical edits: a change proposal drafted by the designated approver's own key is approved at
--    once as that owner, so the version history and proposal record still show who approved it.
--    Keys of everyone else keep creating proposals for the approver.
-- Both run the existing human functions under the key owner's identity for this call only.

create or replace function public.os_agent_as_owner(p_owner uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(p_owner::text, ''), true);
  perform pg_catalog.set_config('request.jwt.claims',
    case when p_owner is null then '' else pg_catalog.json_build_object('sub', p_owner, 'role', 'authenticated')::text end, true);
end;
$$;
revoke all on function public.os_agent_as_owner(uuid) from public, anon, authenticated;

create or replace function public.os_agent_trash_document(p_agent_key_id uuid, p_organization_id uuid, p_document_id uuid, p_reason text default '')
returns public.os_documents
language plpgsql security definer
set search_path = ''
as $$
declare
  k public.os_agent_keys;
  d public.os_documents;
  v_reason text := coalesce(nullif(pg_catalog.btrim(p_reason), ''), 'AI 휴지통 이동');
begin
  k := public.os_assert_agent_write_access(p_agent_key_id, p_organization_id, 'knowledge.delete');
  perform public.os_agent_as_owner(k.owner_user_id);
  d := public.os_set_document_status(p_document_id, 'archived'::public.os_doc_status, v_reason || ' (AI: ' || k.name || ')');
  perform public.os_agent_as_owner(null);
  insert into public.os_agent_audit_logs (organization_id, agent_key_id, owner_user_id, action, document_id, title_snapshot, changed_fields, reason)
  values (p_organization_id, p_agent_key_id, k.owner_user_id, 'knowledge.delete', d.id, d.title, array['status'], v_reason);
  return d;
end;
$$;
revoke all on function public.os_agent_trash_document(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.os_agent_trash_document(uuid, uuid, uuid, text) to service_role;

create or replace function public.os_agent_apply_own_proposal(p_agent_key_id uuid, p_organization_id uuid, p_proposal_id uuid)
returns public.os_documents
language plpgsql security definer
set search_path = ''
as $$
declare
  k public.os_agent_keys;
  prop public.os_document_proposals;
  d public.os_documents;
begin
  k := public.os_assert_agent_write_access(p_agent_key_id, p_organization_id, 'knowledge.update');
  select * into prop from public.os_document_proposals where id = p_proposal_id;
  if not found or prop.status <> 'open' or prop.agent_key_id is distinct from p_agent_key_id then
    raise exception 'OS_PROPOSAL_NOT_OPEN' using errcode = 'P0002';
  end if;
  if not public.os_is_designated_approver(k.owner_user_id) then
    raise exception 'OS_PROPOSAL_DENIED' using errcode = '42501';
  end if;
  perform public.os_agent_as_owner(k.owner_user_id);
  perform public.os_knowledge_workflow_command(pg_catalog.jsonb_build_object(
    'action', 'proposal.decide', 'id', p_proposal_id, 'decision', 'approved',
    'reason', 'AI 바로 반영 — 지정 승인자 본인 키(' || k.name || ')'));
  perform public.os_agent_as_owner(null);
  select * into d from public.os_documents where id = prop.document_id;
  insert into public.os_agent_audit_logs (organization_id, agent_key_id, owner_user_id, action, document_id, title_snapshot, changed_fields, reason)
  values (p_organization_id, p_agent_key_id, k.owner_user_id, 'knowledge.update', d.id, d.title, array['title', 'content_md'], 'canonical proposal applied by owner key');
  return d;
end;
$$;
revoke all on function public.os_agent_apply_own_proposal(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.os_agent_apply_own_proposal(uuid, uuid, uuid) to service_role;
