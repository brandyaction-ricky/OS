-- F2: canonical edits are proposed, not written into the published document.
create table if not exists public.os_document_proposals (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.os_documents(id),
  base_version integer not null check (base_version > 0),
  title text not null,
  content_md text not null,
  folder text not null default '',
  brand text not null default '',
  team text not null default '',
  tags text[] not null default '{}',
  author_id uuid not null references public.os_profiles(id),
  agent_key_id uuid references public.os_agent_keys(id),
  status text not null default 'open' check (status in ('open', 'approved', 'returned', 'withdrawn')),
  reviewer_id uuid references public.os_profiles(id),
  decided_at timestamptz,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_document_proposals_open_idx
  on public.os_document_proposals(status, created_at desc)
  where status = 'open';
create index if not exists os_document_proposals_document_idx
  on public.os_document_proposals(document_id, created_at desc);
alter table public.os_document_proposals enable row level security;
revoke all on public.os_document_proposals from public, anon, authenticated;
grant select, insert, update on public.os_document_proposals to service_role;

create table if not exists public.os_document_proposal_comments (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.os_document_proposals(id),
  line_no integer not null check (line_no > 0),
  body text not null check (length(btrim(body)) between 1 and 2000),
  author_id uuid not null references public.os_profiles(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists os_document_proposal_comments_proposal_idx
  on public.os_document_proposal_comments(proposal_id, line_no, created_at);
alter table public.os_document_proposal_comments enable row level security;
revoke all on public.os_document_proposal_comments from public, anon, authenticated;
grant select, insert, update on public.os_document_proposal_comments to service_role;

-- A newly uploaded image can be referenced by a proposal before it reaches a
-- published document version. Keep it out of the pending-upload cleanup path.
create or replace function public.os_mark_proposal_attachments_referenced()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.os_knowledge_attachment_uploads upload
    where upload.document_id = new.document_id and upload.status = 'deleting'
      and position(upload.encoded_path in new.content_md) > 0
  ) then
    raise exception 'OS_ATTACHMENT_EXPIRED' using errcode = 'P0001';
  end if;
  update public.os_knowledge_attachment_uploads upload
  set status = 'referenced', referenced_at = coalesce(upload.referenced_at, now())
  where upload.document_id = new.document_id and upload.status = 'pending'
    and position(upload.encoded_path in new.content_md) > 0;
  return new;
end;
$$;
revoke all on function public.os_mark_proposal_attachments_referenced() from public, anon, authenticated;
create trigger os_document_proposal_attachment_reference after insert on public.os_document_proposals
for each row execute function public.os_mark_proposal_attachments_referenced();

-- Authenticated users cannot bypass the proposal route through the legacy RPC
-- or a direct table update. Existing service-role legacy AI key behavior remains.
create or replace function public.os_guard_canonical_text_edits()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'canonical' and auth.uid() is not null
    and (new.title is distinct from old.title or new.content_md is distinct from old.content_md)
    and current_setting('os.proposal_apply_ok', true) is distinct from '1' then
    raise exception 'OS_CANONICAL_PROPOSAL_REQUIRED' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger os_guard_canonical_text_edits_trigger before update on public.os_documents
for each row execute function public.os_guard_canonical_text_edits();
revoke all on function public.os_guard_canonical_text_edits() from public, anon, authenticated;

create or replace function public.os_apply_document_proposal(p_proposal_id uuid, p_note text default '')
returns public.os_documents
language plpgsql security definer
set search_path = ''
as $$
declare
  p public.os_document_proposals;
  d public.os_documents;
  v_actor uuid := auth.uid();
  v_text_changed boolean;
begin
  select * into p from public.os_document_proposals where id = p_proposal_id for update;
  if not found or p.status <> 'open' then
    raise exception 'OS_PROPOSAL_NOT_OPEN' using errcode = 'P0002';
  end if;
  select * into d from public.os_documents where id = p.document_id for update;
  if not found or d.status <> 'canonical' then
    raise exception 'OS_PROPOSAL_DOCUMENT_NOT_CANONICAL' using errcode = 'P0002';
  end if;
  if not public.os_can_approve(v_actor, p.author_id) or not public.os_can_approve(v_actor, d.owner_id) then
    raise exception 'OS_PROPOSAL_APPROVAL_DENIED' using errcode = '42501';
  end if;
  if d.current_version <> p.base_version then
    raise exception 'OS_PROPOSAL_VERSION_CONFLICT:%', d.current_version using errcode = '40001';
  end if;
  v_text_changed := p.title is distinct from d.title or p.content_md is distinct from d.content_md;
  perform pg_catalog.set_config('os.proposal_apply_ok', '1', true);
  perform pg_catalog.set_config('os.version_reason', concat_ws(' · ', '승인된 변경 제안', nullif(p_note, '')), true);
  update public.os_documents set title = p.title, content_md = p.content_md,
    folder = p.folder, brand = p.brand, team = p.team, tags = p.tags,
    current_version = case when v_text_changed then d.current_version else d.current_version + 1 end
  where id = p.document_id returning * into d;
  if not v_text_changed then
    insert into public.os_document_versions(document_id,version_no,title,content_md,author_id,reason)
    values (d.id,d.current_version,d.title,d.content_md,v_actor,
      concat_ws(' · ', '승인된 문서 속성 제안', nullif(p_note, '')));
  end if;
  perform pg_catalog.set_config('os.proposal_apply_ok', '', true);
  update public.os_document_proposals set status = 'approved', reviewer_id = v_actor,
    decided_at = now(), note = coalesce(p_note, ''), updated_at = now()
  where id = p.id;
  return d;
end;
$$;
revoke all on function public.os_apply_document_proposal(uuid, text) from public, anon;
grant execute on function public.os_apply_document_proposal(uuid, text) to authenticated;
