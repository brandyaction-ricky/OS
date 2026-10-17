-- A company canonical document can be limited to named members.
-- reader_scope 'all' (default) keeps today's rule: every active member reads it.
-- 'restricted': only admins, the document owner, its steward and the members
-- listed in os_document_readers read it. Admins set it through
-- os_set_document_readers. Additive: existing documents stay 'all'.

alter table public.os_documents add column if not exists reader_scope text not null default 'all';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'os_documents_reader_scope_check') then
    alter table public.os_documents add constraint os_documents_reader_scope_check check (reader_scope in ('all', 'restricted'));
  end if;
end $$;

create table if not exists public.os_document_readers (
  document_id uuid not null references public.os_documents(id) on delete cascade,
  user_id uuid not null references public.os_profiles(id) on delete cascade,
  added_by uuid references public.os_profiles(id),
  created_at timestamptz not null default now(),
  primary key (document_id, user_id)
);
create index if not exists os_document_readers_user_idx on public.os_document_readers (user_id, document_id);
alter table public.os_document_readers enable row level security;
revoke all on public.os_document_readers from public, anon, authenticated;
grant select on public.os_document_readers to authenticated;
grant all on public.os_document_readers to service_role;
drop policy if exists document_readers_read on public.os_document_readers;
create policy document_readers_read on public.os_document_readers for select to authenticated
  using (user_id = (select auth.uid()) or (select public.os_is_admin()));

-- One indexed lookup, reached only for restricted canonical rows.
create or replace function public.os_canonical_reader(p_document uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.os_document_readers where document_id = p_document and user_id = auth.uid())
$$;
revoke all on function public.os_canonical_reader(uuid) from public, anon;
grant execute on function public.os_canonical_reader(uuid) to authenticated, service_role;

-- Row form used by the os_documents read policy: the restricted-canon branch is
-- added before the meeting shortcut so a meeting link cannot bypass it.
create or replace function public.os_workspace_document_row_read(
  p_id uuid, p_status public.os_doc_status, p_owner uuid, p_source text, p_archived_from public.os_doc_status,
  p_archived_by uuid, p_meeting uuid, p_category uuid, p_uid uuid, p_active boolean, p_partner boolean, p_admin boolean, p_grants uuid[],
  p_reader_scope text, p_steward uuid
) returns boolean language sql stable set search_path = '' as $$
  select coalesce(p_active and case
    when p_partner and p_source = 'mcp' and (case when p_status = 'archived' then coalesce(p_archived_from, 'draft') else p_status end) <> 'canonical' then false
    when p_meeting is not null and not public.os_can_read_meeting_record(p_meeting) then false
    when p_status = 'draft' or (p_status = 'archived' and coalesce(p_archived_from, 'draft') = 'draft') then p_owner = p_uid or (p_admin and p_id = any(p_grants))
    when p_status = 'archived' then p_owner = p_uid or p_archived_by = p_uid or p_admin
    when p_status = 'canonical' and coalesce(p_reader_scope, 'all') <> 'all' then p_admin or p_owner = p_uid or p_steward = p_uid or public.os_canonical_reader(p_id)
    when p_meeting is not null then true
    when p_status = 'canonical' then true
    when p_partner then p_source <> 'mcp' and (p_owner = p_uid or public.os_workspace_partner_category(p_category))
    else p_status in ('team', 'review', 'reviewed') end, false)
$$;
revoke all on function public.os_workspace_document_row_read(uuid,public.os_doc_status,uuid,text,public.os_doc_status,uuid,uuid,uuid,uuid,boolean,boolean,boolean,uuid[],text,uuid) from public, anon;
grant execute on function public.os_workspace_document_row_read(uuid,public.os_doc_status,uuid,text,public.os_doc_status,uuid,uuid,uuid,uuid,boolean,boolean,boolean,uuid[],text,uuid) to authenticated, service_role;

alter policy workspace_documents_read on public.os_documents using (
  public.os_workspace_document_row_read(id, status, owner_id, source, archived_from_status, archived_by, meeting_record_id, category_id,
    (select auth.uid()), (select public.os_is_active_member()), (select public.os_is_partner()), (select public.os_is_admin()),
    (select public.os_workspace_my_note_grants()), reader_scope, steward_id)
  and (parent_document_id is null or (parent_document_id <> id and public.os_workspace_ancestors_read(parent_document_id)))
);
drop function if exists public.os_workspace_document_row_read(uuid,public.os_doc_status,uuid,text,public.os_doc_status,uuid,uuid,uuid,uuid,boolean,boolean,boolean,uuid[]);

-- Per-document form used by ancestors, chunks, versions, links, pins, drafts,
-- candidates and workflow RPCs: same branch, same order.
create or replace function public.os_workspace_document_read(p_document uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select public.os_is_active_member() and exists (
    select 1 from public.os_documents d where d.id = p_document and case
      when public.os_is_partner() and d.source = 'mcp' and (case when d.status = 'archived' then coalesce(d.archived_from_status, 'draft') else d.status end) <> 'canonical' then false
      when d.meeting_record_id is not null and not public.os_can_read_meeting_record(d.meeting_record_id) then false
      when d.status = 'draft' or (d.status = 'archived' and coalesce(d.archived_from_status, 'draft') = 'draft') then d.owner_id = auth.uid() or public.os_has_note_access(d.id)
      when d.status = 'archived' then d.owner_id = auth.uid() or d.archived_by = auth.uid() or public.os_is_admin()
      when d.status = 'canonical' and d.reader_scope <> 'all' then public.os_is_admin() or d.owner_id = auth.uid() or d.steward_id = auth.uid() or public.os_canonical_reader(d.id)
      when d.meeting_record_id is not null then public.os_can_read_meeting_record(d.meeting_record_id)
      when d.status = 'canonical' then true
      when public.os_is_partner() then d.source <> 'mcp' and (d.owner_id = auth.uid() or exists(
        select 1 from public.os_doc_categories c where c.id = d.category_id and c.archived_at is null and auth.uid() = any(c.partner_ids)))
      else d.status in ('team', 'review', 'reviewed') end
  )
$$;

-- Admin-only setter, called by the API with the service role (like os_set_document_steward).
create or replace function public.os_set_document_readers(p_actor uuid, p_document uuid, p_expected_version integer, p_scope text, p_readers uuid[])
returns public.os_documents language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.os_documents; wanted uuid[] := coalesce(p_readers, '{}');
begin
  if not exists (select 1 from public.os_profiles where id = p_actor and is_active and role = 'admin') then
    raise exception using errcode = '42501', message = 'ADMIN_REQUIRED';
  end if;
  if p_scope not in ('all', 'restricted') then raise exception using errcode = '22023', message = 'READER_SCOPE_INVALID'; end if;
  select * into d from public.os_documents where id = p_document and status = 'canonical' for update;
  if not found then raise exception using errcode = 'P0002', message = 'DOCUMENT_NOT_FOUND'; end if;
  if d.current_version <> p_expected_version then raise exception using errcode = '40001', message = 'VERSION_CONFLICT'; end if;
  if exists (select 1 from unnest(wanted) r(id) where not exists (select 1 from public.os_profiles p where p.id = r.id and p.is_active)) then
    raise exception using errcode = '23514', message = 'READER_INVALID';
  end if;
  if p_scope = 'all' then wanted := '{}'; end if;
  delete from public.os_document_readers where document_id = p_document and not (user_id = any(wanted));
  insert into public.os_document_readers(document_id, user_id, added_by)
    select p_document, r.id, p_actor from unnest(wanted) r(id) on conflict do nothing;
  if d.reader_scope is distinct from p_scope then
    update public.os_documents set reader_scope = p_scope where id = p_document returning * into d;
  end if;
  insert into public.os_document_events(document_id, from_status, to_status, actor_id, note)
    values (p_document, d.status, d.status, p_actor, case when p_scope = 'all' then '열람 범위: 전 직원' else '열람 범위: 지정한 직원 ' || cardinality(wanted) || '명' end);
  return d;
end $$;
revoke all on function public.os_set_document_readers(uuid, uuid, integer, text, uuid[]) from public, anon, authenticated;
grant execute on function public.os_set_document_readers(uuid, uuid, integer, text, uuid[]) to service_role;
