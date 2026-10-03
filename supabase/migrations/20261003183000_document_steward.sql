-- F5: optional accountable steward; existing owner/status/version remain unchanged.
alter table public.os_documents add column if not exists steward_id uuid references public.os_profiles(id) on delete set null;
create index if not exists os_documents_canonical_steward_idx on public.os_documents(steward_id, id)
  where status = 'canonical';

create or replace function public.os_set_document_steward(p_actor uuid, p_document uuid, p_expected_version integer, p_steward uuid)
returns public.os_documents language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.os_documents;
begin
  if not exists (select 1 from public.os_profiles where id = p_actor and is_active and role = 'admin') then
    raise exception using errcode = '42501', message = 'ADMIN_REQUIRED';
  end if;
  select * into d from public.os_documents where id = p_document and status <> 'archived' for update;
  if not found then raise exception using errcode = 'P0002', message = 'DOCUMENT_NOT_FOUND'; end if;
  if d.current_version <> p_expected_version then raise exception using errcode = '40001', message = 'VERSION_CONFLICT'; end if;
  if p_steward is not null and not exists(select 1 from public.os_profiles where id = p_steward and is_active) then
    raise exception using errcode = '23514', message = 'STEWARD_INVALID';
  end if;
  if d.steward_id is distinct from p_steward then
    update public.os_documents set steward_id = p_steward where id = p_document returning * into d;
    insert into public.os_document_events(document_id, from_status, to_status, actor_id, note)
      values(p_document, d.status, d.status, p_actor, '문서 담당 변경');
  end if;
  return d;
end $$;
revoke all on function public.os_set_document_steward(uuid, uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.os_set_document_steward(uuid, uuid, integer, uuid) to service_role;
