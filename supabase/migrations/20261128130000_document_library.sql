-- 자료실 (대표 2026-11-28): company canon keeps only the standards people work by; reference originals
-- (reviews, meeting summaries, lecture notes, benchmarks, earlier history) move to 자료실. Additive only:
-- a document's status, text, owner, version and link stay as they are — 자료실 is a list beside it, so
-- moving back is deleting the row. Only admins move documents, and only company canon.

create table if not exists public.os_document_library (
  document_id uuid primary key references public.os_documents(id) on delete cascade,
  moved_by uuid references public.os_profiles(id),
  moved_at timestamptz not null default now(),
  note text not null default '' check (char_length(note) <= 300)
);
alter table public.os_document_library enable row level security;
drop policy if exists os_document_library_read on public.os_document_library;
create policy os_document_library_read on public.os_document_library for select to authenticated
  using (public.os_workspace_page_read(document_id));
revoke all on public.os_document_library from anon;
grant select on public.os_document_library to authenticated;

create or replace function public.os_set_document_library(p_ids uuid[], p_on boolean, p_note text default '')
 returns integer
 language plpgsql security definer set search_path to ''
as $function$
declare n integer;
begin
  if not public.os_is_admin() then raise exception 'OS_LIBRARY_ADMIN_REQUIRED' using errcode='42501'; end if;
  if coalesce(array_length(p_ids,1),0)=0 or array_length(p_ids,1)>1000 then raise exception 'OS_LIBRARY_INVALID' using errcode='22023'; end if;
  if p_on then
    insert into public.os_document_library(document_id,moved_by,note)
      select d.id,auth.uid(),left(coalesce(p_note,''),300) from public.os_documents d
      where d.id=any(p_ids) and d.status='canonical'
      on conflict (document_id) do nothing;
  else
    delete from public.os_document_library where document_id=any(p_ids);
  end if;
  get diagnostics n=row_count;
  insert into public.os_knowledge_events(actor_id,action,target_type,target_id,detail)
    select auth.uid(),case when p_on then 'library_add' else 'library_remove' end,'document',x,jsonb_build_object('note',coalesce(p_note,''))
    from unnest(p_ids) x;
  return n;
end $function$;
revoke all on function public.os_set_document_library(uuid[],boolean,text) from public,anon;
grant execute on function public.os_set_document_library(uuid[],boolean,text) to authenticated;
