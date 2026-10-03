-- Page hierarchy is additive: existing documents remain root pages and retain
-- their folder/content/version history. Apply only after review in the DEV DB.
alter table public.os_documents
  add column if not exists parent_document_id uuid,
  add column if not exists page_order integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.os_documents'::regclass
      and conname = 'os_documents_parent_document_id_fkey'
  ) then
    alter table public.os_documents
      add constraint os_documents_parent_document_id_fkey
      foreign key (parent_document_id) references public.os_documents(id)
      on delete set null;
  end if;
end $$;

create index if not exists os_documents_parent_page_order_idx
  on public.os_documents (parent_document_id, page_order, created_at, id)
  where parent_document_id is not null;

create or replace function public.os_documents_page_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  parent_row public.os_documents;
begin
  if tg_op = 'UPDATE' then
    if new.status = 'draft' and new.status is distinct from old.status
       and exists (
         select 1 from public.os_documents child
         where child.parent_document_id = new.id
           and child.status <> 'archived'
           and (child.status <> 'draft' or child.owner_id <> new.owner_id)
       ) then
      raise exception 'OS_PAGE_CHILD_VISIBILITY' using errcode = '23514';
    end if;
  end if;
  if new.parent_document_id is null then return new; end if;
  if new.parent_document_id = new.id then
    raise exception 'OS_PAGE_CYCLE' using errcode = '23514';
  end if;

  select * into parent_row from public.os_documents where id = new.parent_document_id;
  if not found or parent_row.status = 'archived' then
    raise exception 'OS_PAGE_PARENT_UNAVAILABLE' using errcode = '23514';
  end if;
  if parent_row.status = 'draft' and new.status <> 'archived'
     and (new.status <> 'draft' or new.owner_id <> parent_row.owner_id) then
    raise exception 'OS_PAGE_PARENT_VISIBILITY' using errcode = '23514';
  end if;

  -- Moving a child to another folder outside its parent's subtree detaches it.
  -- A cascade after moving the parent sees the parent's new folder and keeps
  -- the relationship intact.
  if parent_row.folder is distinct from new.folder then
    if tg_op = 'UPDATE' then
      if new.folder is distinct from old.folder
         and new.parent_document_id is not distinct from old.parent_document_id then
        new.parent_document_id := null;
        return new;
      end if;
    end if;
    raise exception 'OS_PAGE_FOLDER_MISMATCH' using errcode = '23514';
  end if;

  if exists (
    with recursive ancestors as (
      select id, parent_document_id, 1 as depth
      from public.os_documents where id = new.parent_document_id
      union all
      select d.id, d.parent_document_id, a.depth + 1
      from public.os_documents d join ancestors a on d.id = a.parent_document_id
      where a.depth < 64
    )
    select 1 from ancestors where id = new.id
  ) then
    raise exception 'OS_PAGE_CYCLE' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger os_documents_page_guard_trigger
  before insert or update of parent_document_id, folder, status
  on public.os_documents
  for each row execute function public.os_documents_page_guard();

-- Folder relocation of a parent takes every descendant along in one DB
-- transaction, including moves made through existing document APIs.
create or replace function public.os_documents_page_folder_cascade()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.folder is not distinct from old.folder then return new; end if;
  -- A folder move must not silently rewrite another person's child page.
  -- This also fails closed for service-role/AI writes without a user identity.
  if not public.os_is_admin() and exists (
    with recursive descendants as (
      select id, owner_id, parent_document_id from public.os_documents
      where parent_document_id = new.id
      union all
      select d.id, d.owner_id, d.parent_document_id from public.os_documents d
      join descendants p on d.parent_document_id = p.id
    )
    select 1 from descendants where owner_id is distinct from auth.uid()
  ) then
    raise exception 'OS_PAGE_CHILD_MOVE_DENIED' using errcode = '42501';
  end if;
  with recursive descendants as (
    select id from public.os_documents where parent_document_id = new.id
    union all
    select d.id from public.os_documents d
    join descendants p on d.parent_document_id = p.id
  )
  update public.os_documents d
     set folder = new.folder
   where d.id in (select id from descendants)
     and d.folder is distinct from new.folder;
  return new;
end;
$$;

revoke all on function public.os_documents_page_folder_cascade() from public, anon, authenticated;
create trigger os_documents_page_folder_cascade_trigger
  after update of folder on public.os_documents
  for each row execute function public.os_documents_page_folder_cascade();

-- A parent with active children must be emptied or archived bottom-up. This
-- avoids leaving an active page hidden below a trashed ancestor.
create or replace function public.os_documents_page_archive_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'archived' and old.status <> 'archived'
     and exists (
       select 1 from public.os_documents child
       where child.parent_document_id = new.id and child.status <> 'archived'
     ) then
    raise exception 'OS_PAGE_HAS_ACTIVE_CHILDREN' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger os_documents_page_archive_guard_trigger
  before update of status on public.os_documents
  for each row execute function public.os_documents_page_archive_guard();
