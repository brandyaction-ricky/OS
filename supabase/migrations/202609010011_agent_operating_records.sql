begin;

-- Extend an existing write PAT to operating records without weakening the
-- three human gates: permissions, external publishing and permanent delete.
alter table public.os_agent_keys drop constraint if exists os_agent_keys_scopes_check;
update public.os_agent_keys
set scopes = array['knowledge.read', 'knowledge.write', 'records.read', 'records.write']::text[]
where 'knowledge.write' = any(scopes) and not ('records.write' = any(scopes));
update public.os_agent_keys
set scopes = array_append(scopes, 'records.read')
where not ('records.read' = any(scopes));
alter table public.os_agent_keys
  add constraint os_agent_keys_scopes_check check (
    cardinality(scopes) between 1 and 4
    and scopes <@ array['knowledge.read', 'knowledge.write', 'records.read', 'records.write']::text[]
  );

alter table public.os_agent_audit_logs
  add column if not exists record_id uuid references public.os_records(id) on delete set null;
alter table public.os_agent_audit_logs drop constraint if exists os_agent_audit_logs_action_check;
alter table public.os_agent_audit_logs
  add constraint os_agent_audit_logs_action_check check (action in (
    'knowledge.create', 'knowledge.update', 'knowledge.delete',
    'record.create', 'record.update', 'record.delete', 'record.restore'
  ));
create index if not exists os_agent_audit_logs_record_created_idx
  on public.os_agent_audit_logs (record_id, created_at desc);

commit;
