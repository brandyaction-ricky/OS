-- 나만 보기 (대표 요청 2026-11-08): a personal note its owner marks 「나만 보기」 is read only by the owner and the people the
-- owner shared it with (os_document_readers). Admins included: the audit route (note.access) cannot open it, and no admin
-- read, edit or delete reaches it without the owner's consent, which is the owner sharing it or turning the setting off.
-- Reading a personal note is already limited to its owner, its named readers and an admin holding an audit grant
-- (workspace_documents_read, restrictive); a 나만 보기 note can never get that grant, so only the first two remain.
-- Additive: one column (default off), two guard triggers and one owner-only setter.
begin;

alter table public.os_documents add column if not exists owner_only boolean not null default false;

-- Edits, trash and deletes by anyone else are refused, including through security-definer commands run as an admin.
-- Server jobs (no signed-in user) pass. The setting goes with the note's personal state: shared to the team, it is off.
-- A page created under a 나만 보기 note of the same owner is 나만 보기 too.
create function public.os_documents_owner_only_guard()
 returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
begin
  if tg_op = 'INSERT' then
    if new.parent_document_id is not null and exists (select 1 from public.os_documents p
      where p.id = new.parent_document_id and p.owner_only and p.owner_id = new.owner_id) then new.owner_only := true; end if;
    return new;
  end if;
  if auth.uid() is not null and auth.uid() <> old.owner_id
    and (old.owner_only or (tg_op = 'UPDATE' and new.owner_only is distinct from old.owner_only))
    then raise exception using errcode = '42501', message = 'OS_NOTE_OWNER_ONLY'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.status not in ('draft', 'archived') then new.owner_only := false; end if;
  return new;
end $$;
create trigger os_documents_owner_only_guard before insert or update or delete on public.os_documents
  for each row execute function public.os_documents_owner_only_guard();

-- The audit route grants an admin 24 hours on a personal note; never on a 나만 보기 note.
create function public.os_note_grant_owner_only_guard()
 returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
begin
  if exists (select 1 from public.os_documents where id = new.document_id and owner_only)
    then raise exception using errcode = '42501', message = 'OS_NOTE_OWNER_ONLY'; end if;
  return new;
end $$;
create trigger os_note_grant_owner_only_guard before insert on public.os_note_access_grants
  for each row execute function public.os_note_grant_owner_only_guard();

-- The owner turns it on or off for the note and the pages under it. Turning it on ends any live audit grant.
create function public.os_set_note_owner_only(p_actor uuid, p_document uuid, p_on boolean)
 returns integer language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare d public.os_documents; ids uuid[];
begin
  select * into d from public.os_documents where id = p_document for update;
  if not found or d.owner_id <> p_actor or not exists (select 1 from public.os_profiles where id = p_actor and is_active)
    then raise exception using errcode = '42501', message = 'NOTE_PRIVATE_OWNER_ONLY'; end if;
  if d.status <> 'draft' then raise exception using errcode = '22023', message = 'NOTE_PRIVATE_DRAFT_ONLY'; end if;
  with recursive tree as (
    select id from public.os_documents where id = p_document
    union select c.id from public.os_documents c join tree t on c.parent_document_id = t.id
      where c.owner_id = p_actor and c.status in ('draft', 'archived')
  ) select array_agg(id) into ids from tree;
  update public.os_documents set owner_only = p_on, updated_at = now() where id = any(ids) and owner_only is distinct from p_on;
  if p_on then delete from public.os_note_access_grants where document_id = any(ids); end if;
  insert into public.os_document_events(document_id, from_status, to_status, actor_id, note)
    values (p_document, d.status, d.status, p_actor, case when p_on then '나만 보기 켬' else '나만 보기 끔' end);
  return cardinality(ids);
end $$;
revoke all on function public.os_documents_owner_only_guard(), public.os_note_grant_owner_only_guard(),
  public.os_set_note_owner_only(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.os_set_note_owner_only(uuid, uuid, boolean) to service_role;

commit;
