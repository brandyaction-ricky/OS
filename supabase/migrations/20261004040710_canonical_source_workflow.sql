-- Additive workflow only. No existing document, status or version is changed.
-- Apply separately after reviewing the prior document-proposal migration.
create table public.os_canonical_sources (
  document_id uuid primary key references public.os_documents(id),
  url text not null check (length(url) between 1 and 2000),
  enabled boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  owner_id uuid not null references public.os_profiles(id),
  checked_at timestamptz,
  last_status text not null default 'not_checked',
  updated_at timestamptz not null default now()
);
create index os_canonical_sources_due_idx on public.os_canonical_sources(checked_at) where enabled;
create index os_canonical_sources_owner_idx on public.os_canonical_sources(owner_id);
alter table public.os_canonical_sources enable row level security;
revoke all on public.os_canonical_sources from public, anon, authenticated;
grant select, insert, update on public.os_canonical_sources to service_role;

create table public.os_canonical_runs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.os_documents(id),
  requested_by uuid not null references public.os_profiles(id),
  kind text not null check (kind in ('sync','rules')),
  mode text not null check (mode in ('queue','api')),
  status text not null check (status in ('queued','running','done','failed')),
  source_version integer not null check (source_version > 0),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  request_key text not null check (length(request_key) <= 200),
  result jsonb not null default '{}',
  raw_output text,
  model text,
  usage jsonb not null default '{}',
  cost_usd numeric,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, requested_by, kind, request_key)
);
create index os_canonical_runs_owner_idx on public.os_canonical_runs(requested_by, created_at desc);
create index os_canonical_runs_document_idx on public.os_canonical_runs(document_id, created_at desc);
alter table public.os_canonical_runs enable row level security;
-- API checks the current document AND ancestor visibility before every read.
-- RLS with no public policy is intentional: no direct Data API access, including
-- staff access to provider output or results of a now-private document.
revoke all on public.os_canonical_runs from public, anon, authenticated;
grant select, insert, update on public.os_canonical_runs to service_role;

-- Proposal and completion receipt are committed together. Repeated calls return
-- the same receipt; failure never overwrites the approved document.
create function public.os_finish_canonical_sync(p_run uuid, p_content text)
returns public.os_canonical_runs language plpgsql set search_path = '' as $$
declare r public.os_canonical_runs; d public.os_documents; proposal uuid;
begin
  select * into r from public.os_canonical_runs where id=p_run for update;
  if not found or r.kind <> 'sync' then raise exception 'CANON_RUN_NOT_FOUND'; end if;
  if r.status='done' then return r; end if;
  if r.status <> 'running' then raise exception 'CANON_RUN_STATE'; end if;
  select * into d from public.os_documents where id=r.document_id for share;
  if d.status <> 'canonical' or d.current_version <> r.source_version then raise exception 'CANON_SOURCE_CHANGED'; end if;
  if length(p_content) not between 1 and 500000 then raise exception 'CANON_CONTENT_INVALID'; end if;
  if p_content is distinct from d.content_md then
    insert into public.os_document_proposals(document_id,base_version,title,content_md,folder,brand,team,tags,author_id,note)
    values(d.id,d.current_version,d.title,p_content,d.folder,coalesce(d.brand,''),d.team,d.tags,r.requested_by,'외부 원문 동기화 변경 제안') returning id into proposal;
  end if;
  update public.os_canonical_runs set status='done',result=jsonb_build_object('proposalId',proposal,'unchanged',proposal is null),updated_at=now()
  where id=p_run returning * into r;
  return r;
end; $$;
revoke all on function public.os_finish_canonical_sync(uuid,text) from public,anon,authenticated;
grant execute on function public.os_finish_canonical_sync(uuid,text) to service_role;

-- A person explicitly saves one grounded candidate as a personal draft Skill.
-- Row locking makes double clicks/retries idempotent. No automatic promotion.
create function public.os_adopt_canonical_rule(p_run uuid,p_index integer,p_actor uuid)
returns uuid language plpgsql set search_path = '' as $$
declare r public.os_canonical_runs; d public.os_documents; rule jsonb; skill uuid;
begin
  select * into r from public.os_canonical_runs where id=p_run for update;
  if not found or r.kind<>'rules' or r.status<>'done' or r.requested_by<>p_actor then raise exception 'CANON_RUN_FORBIDDEN'; end if;
  select * into d from public.os_documents where id=r.document_id for share;
  if d.status<>'canonical' or d.current_version<>r.source_version then raise exception 'CANON_SOURCE_CHANGED'; end if;
  if not exists(select 1 from public.os_profiles where id=p_actor and is_active) then raise exception 'CANON_ACTOR_INACTIVE'; end if;
  if p_index<0 or p_index>=jsonb_array_length(r.result->'rules') then raise exception 'CANON_RULE_INVALID'; end if;
  skill := (r.result->'skillIds'->>p_index::text)::uuid;
  if skill is not null then return skill; end if;
  rule := r.result->'rules'->p_index;
  insert into public.os_records(record_type,title,description,status,owner_id,created_by,updated_by,team,brand,metadata)
  values('skill',left(rule->>'text',240),rule->>'text','draft',p_actor,p_actor,p_actor,d.team,coalesce(d.brand,''),
    jsonb_build_object('scope','personal','sourceDocumentId',d.id,'sourceVersion',d.current_version,'sourceQuote',rule->>'quote',
      'sourceLineStart',rule->'lineStart','sourceLineEnd',rule->'lineEnd','ruleKind',rule->>'kind','channels',rule->'channels','generationId',r.id,'finalApprovalRequired',true))
  returning id into skill;
  update public.os_canonical_runs set result=jsonb_set(result,'{skillIds}',coalesce(result->'skillIds','{}')||jsonb_build_object(p_index::text,skill)),updated_at=now() where id=p_run;
  return skill;
end; $$;
revoke all on function public.os_adopt_canonical_rule(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.os_adopt_canonical_rule(uuid,integer,uuid) to service_role;
