-- Document sharing (owner request 2026-10-22: "특정 직원 공유, 사내 링크 복사, 외부 공개 링크").
-- Additive.
-- 1. A personal note (draft) can be shared read-only with named active members. It reuses
--    os_document_readers, which so far only listed readers of a restricted canon. A trashed
--    note stays owner-only. Search chunks and version history stay owner-only.
-- 2. External links: a random token whose hash is stored here; the public page reads through
--    the service role, only while the link is neither revoked nor expired.
begin;

-- Reads: a named reader may also read a personal note shared with them.
create or replace function public.os_workspace_document_row_read(p_id uuid, p_status os_doc_status, p_owner uuid, p_source text, p_archived_from os_doc_status, p_archived_by uuid, p_meeting uuid, p_category uuid, p_uid uuid, p_active boolean, p_partner boolean, p_admin boolean, p_grants uuid[], p_reader_scope text, p_steward uuid)
 returns boolean
 language sql stable set search_path to ''
as $function$
  select coalesce(p_active and case
    when p_partner and p_source = 'mcp' and (case when p_status = 'archived' then coalesce(p_archived_from, 'draft') else p_status end) <> 'canonical' then false
    when p_meeting is not null and not public.os_can_read_meeting_record(p_meeting) then false
    when p_status = 'draft' then p_owner = p_uid or (p_admin and p_id = any(p_grants)) or public.os_canonical_reader(p_id)
    when p_status = 'archived' and coalesce(p_archived_from, 'draft') = 'draft' then p_owner = p_uid or (p_admin and p_id = any(p_grants))
    when p_status = 'archived' then p_owner = p_uid or p_archived_by = p_uid or p_admin
    when p_status = 'canonical' and coalesce(p_reader_scope, 'all') <> 'all' then p_admin or p_owner = p_uid or p_steward = p_uid or public.os_canonical_reader(p_id)
    when p_meeting is not null then true
    when p_status = 'canonical' then true
    when p_partner then p_source <> 'mcp' and (p_owner = p_uid or public.os_workspace_partner_category(p_category))
    else p_status in ('team', 'review', 'reviewed') end, false)
$function$;

create or replace function public.os_workspace_document_read(p_document uuid)
 returns boolean
 language sql stable security definer set search_path to ''
as $function$
  select public.os_is_active_member() and exists (
    select 1 from public.os_documents d where d.id = p_document and case
      when public.os_is_partner() and d.source = 'mcp' and (case when d.status = 'archived' then coalesce(d.archived_from_status, 'draft') else d.status end) <> 'canonical' then false
      when d.meeting_record_id is not null and not public.os_can_read_meeting_record(d.meeting_record_id) then false
      when d.status = 'draft' then d.owner_id = auth.uid() or public.os_has_note_access(d.id) or public.os_canonical_reader(d.id)
      when d.status = 'archived' and coalesce(d.archived_from_status, 'draft') = 'draft' then d.owner_id = auth.uid() or public.os_has_note_access(d.id)
      when d.status = 'archived' then d.owner_id = auth.uid() or d.archived_by = auth.uid() or public.os_is_admin()
      when d.status = 'canonical' and d.reader_scope <> 'all' then public.os_is_admin() or d.owner_id = auth.uid() or d.steward_id = auth.uid() or public.os_canonical_reader(d.id)
      when d.meeting_record_id is not null then public.os_can_read_meeting_record(d.meeting_record_id)
      when d.status = 'canonical' then true
      when public.os_is_partner() then d.source <> 'mcp' and (d.owner_id = auth.uid() or exists(
        select 1 from public.os_doc_categories c where c.id = d.category_id and c.archived_at is null and auth.uid() = any(c.partner_ids)))
      else d.status in ('team', 'review', 'reviewed') end
  )
$function$;

-- The permissive row policy hid every other member's draft before the rule above ran.
drop policy os_documents_select on public.os_documents;
create policy os_documents_select on public.os_documents for select to authenticated
using (((select auth.uid()) is not null) and ((select public.os_is_admin()) or owner_id = (select auth.uid())
  or (status <> 'draft' and (status <> 'team' or (select public.os_is_active_member())))
  or (status = 'draft' and public.os_canonical_reader(id))));

-- The owner shares their own personal note. Readers are active staff other than the owner.
create function public.os_share_note_readers(p_actor uuid, p_document uuid, p_readers uuid[])
 returns integer
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare d public.os_documents; wanted uuid[] := coalesce(p_readers, '{}');
begin
  select * into d from public.os_documents where id = p_document for update;
  if not found or d.owner_id <> p_actor or not exists (select 1 from public.os_profiles where id = p_actor and is_active)
    then raise exception using errcode = '42501', message = 'NOTE_SHARE_OWNER_ONLY'; end if;
  if d.status <> 'draft' then raise exception using errcode = '22023', message = 'NOTE_SHARE_DRAFT_ONLY'; end if;
  if cardinality(wanted) > 50 or p_actor = any(wanted) or exists (select 1 from unnest(wanted) r(id)
    where not exists (select 1 from public.os_profiles p where p.id = r.id and p.is_active and p.member_kind = 'staff'))
    then raise exception using errcode = '23514', message = 'READER_INVALID'; end if;
  delete from public.os_document_readers where document_id = p_document and not (user_id = any(wanted));
  insert into public.os_document_readers(document_id, user_id, added_by)
    select p_document, r.id, p_actor from unnest(wanted) r(id) on conflict do nothing;
  insert into public.os_document_events(document_id, from_status, to_status, actor_id, note)
    values (p_document, d.status, d.status, p_actor, case when cardinality(wanted) = 0 then '공유 해제' else '지정한 직원 ' || cardinality(wanted) || '명에게 열람 공유' end);
  return cardinality(wanted);
end $function$;
revoke all on function public.os_share_note_readers(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.os_share_note_readers(uuid, uuid, uuid[]) to service_role;

create table public.os_document_share_links (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.os_documents(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references public.os_profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references public.os_profiles(id),
  check (expires_at > created_at and expires_at <= created_at + interval '31 days')
);
create index os_document_share_links_document_idx on public.os_document_share_links(document_id, created_at desc);
alter table public.os_document_share_links enable row level security;
revoke all on public.os_document_share_links from public, anon, authenticated;
grant all on public.os_document_share_links to service_role;

commit;
