-- A private document owner can delegate read access to one existing agent key.
-- The document status, owner, body, and ordinary team visibility are unchanged.
create table public.os_agent_document_read_grants (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.os_documents(id) on delete cascade,
  agent_key_id uuid not null references public.os_agent_keys(id) on delete cascade,
  grantee_owner_id uuid not null,
  granted_by uuid not null references public.os_profiles(id),
  reason text not null check (length(btrim(reason)) between 1 and 500),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  check (expires_at is null or expires_at > created_at)
);
create index os_agent_document_read_grants_active
  on public.os_agent_document_read_grants(agent_key_id, document_id, expires_at)
  where revoked_at is null;
create index os_agent_document_read_grants_owner
  on public.os_agent_document_read_grants(granted_by, document_id, created_at desc);
create index os_agent_document_read_grants_document
  on public.os_agent_document_read_grants(document_id);

alter table public.os_agent_document_read_grants enable row level security;
revoke all on public.os_agent_document_read_grants from public, anon, authenticated;
grant select on public.os_agent_document_read_grants to service_role;

create function public.os_grant_agent_document_read(
  p_document uuid, p_agent_key uuid, p_reason text, p_expires_at timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  u uuid := auth.uid();
  d public.os_documents;
  k public.os_agent_keys;
  grant_id uuid;
begin
  if u is null or not public.os_is_active_member() then
    raise exception 'OS_ACTIVE_USER_REQUIRED' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) not between 1 and 500
     or (p_expires_at is not null and (p_expires_at <= now() or p_expires_at > now() + interval '30 days')) then
    raise exception 'OS_AGENT_READ_GRANT_INVALID' using errcode = '22023';
  end if;
  select * into d from public.os_documents where id = p_document for update;
  if not found or d.owner_id <> u or d.status <> 'draft' or d.meeting_record_id is not null then
    raise exception 'OS_AGENT_READ_GRANT_DENIED' using errcode = '42501';
  end if;
  select * into k from public.os_agent_keys where id = p_agent_key;
  if not found or not k.active or (k.expires_at is not null and k.expires_at <= now())
     or not ('knowledge.read' = any(k.scopes))
     or k.organization_id is distinct from (select o.id from public.os_organizations o where o.slug = 'brandyaction')
     or (k.owner_user_id <> u and not public.os_is_admin())
     or not exists (select 1 from public.os_profiles p where p.id = k.owner_user_id and p.is_active and p.member_kind = 'staff') then
    raise exception 'OS_AGENT_READ_GRANT_KEY_INVALID' using errcode = '42501';
  end if;
  insert into public.os_agent_document_read_grants(document_id, agent_key_id, grantee_owner_id, granted_by, reason, expires_at)
  values (p_document, p_agent_key, k.owner_user_id, u, btrim(p_reason), p_expires_at) returning id into grant_id;
  insert into public.os_knowledge_events(actor_id, action, target_type, target_id, detail)
  values (u, 'agent_private_read_granted', 'document', p_document,
    jsonb_build_object('agentKeyId', p_agent_key, 'expiresAt', p_expires_at));
  return grant_id;
end;
$$;

create function public.os_revoke_agent_document_read(p_document uuid, p_agent_key uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  u uuid := auth.uid();
  changed integer;
begin
  if u is null or not public.os_is_active_member()
     or not exists (select 1 from public.os_documents d where d.id = p_document and d.owner_id = u) then
    raise exception 'OS_AGENT_READ_GRANT_DENIED' using errcode = '42501';
  end if;
  update public.os_agent_document_read_grants
  set revoked_at = now()
  where document_id = p_document and agent_key_id = p_agent_key and granted_by = u and revoked_at is null;
  get diagnostics changed = row_count;
  if changed > 0 then
    insert into public.os_knowledge_events(actor_id, action, target_type, target_id, detail)
    values (u, 'agent_private_read_revoked', 'document', p_document,
      jsonb_build_object('agentKeyId', p_agent_key));
  end if;
  return changed;
end;
$$;

revoke execute on function public.os_grant_agent_document_read(uuid, uuid, text, timestamptz) from public, anon;
revoke execute on function public.os_revoke_agent_document_read(uuid, uuid) from public, anon;
grant execute on function public.os_grant_agent_document_read(uuid, uuid, text, timestamptz) to authenticated;
grant execute on function public.os_revoke_agent_document_read(uuid, uuid) to authenticated;
