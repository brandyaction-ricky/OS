begin;

-- Obsidian imports are idempotent by normalized vault path.
do $$
begin
  if exists (
    select 1
    from public.os_documents
    where source_ref is not null
    group by source, source_ref
    having count(*) > 1
  ) then
    raise exception 'OS_DUPLICATE_DOCUMENT_SOURCE_REF';
  end if;
end;
$$;

create unique index if not exists os_documents_source_ref_unique
  on public.os_documents (source, source_ref)
  where source_ref is not null;

-- Personal drafts stay owner-scoped. Every active employee may deliberately edit
-- company canonical documents; the UI provides the explicit warning gate.
drop policy if exists os_documents_update on public.os_documents;
create policy os_documents_update on public.os_documents
  for update to authenticated
  using (
    public.os_is_admin()
    or (owner_id = auth.uid() and status <> 'canonical'::public.os_doc_status)
    or (
      status = 'canonical'::public.os_doc_status
      and exists (
        select 1 from public.os_profiles p
        where p.id = auth.uid() and p.is_active
      )
    )
  )
  with check (
    public.os_is_admin()
    or (owner_id = auth.uid() and status <> 'canonical'::public.os_doc_status)
    or (
      status = 'canonical'::public.os_doc_status
      and exists (
        select 1 from public.os_profiles p
        where p.id = auth.uid() and p.is_active
      )
    )
  );

create or replace function public.os_set_document_status(
  p_document_id uuid,
  p_to public.os_doc_status,
  p_note text default ''
) returns public.os_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.os_documents;
  v_from public.os_doc_status;
  v_uid uuid := auth.uid();
  v_owner boolean;
  v_active boolean;
  v_admin boolean := public.os_is_admin();
  ok boolean := false;
begin
  select * into d from public.os_documents where id = p_document_id for update;
  if not found then raise exception 'OS_DOC_NOT_FOUND' using errcode = 'P0002'; end if;

  select exists(
    select 1 from public.os_profiles p where p.id = v_uid and p.is_active
  ) into v_active;
  v_from := d.status;
  v_owner := d.owner_id = v_uid;
  if v_from = p_to then return d; end if;

  ok := case
    when v_from = 'draft' and p_to = 'team' then v_owner or v_admin
    when v_from in ('draft', 'team', 'review', 'reviewed') and p_to = 'canonical'
      then (v_owner and v_active) or v_admin
    when v_from = 'team' and p_to = 'review' then (v_owner and v_active) or v_admin
    when v_from = 'review' and p_to = 'reviewed' then v_active or v_admin
    when v_from = 'reviewed' and p_to = 'review' then v_active or v_admin
    when v_from = 'canonical' and p_to = 'review' then v_active or v_admin
    when p_to = 'archived' then v_admin or (v_owner and v_from <> 'canonical')
    when p_to = 'draft' and v_from in ('team', 'review', 'reviewed') then v_owner or v_admin
    when v_from = 'archived' and p_to in ('draft', 'team') then v_owner or v_admin
    else false
  end;
  if not ok then
    raise exception 'OS_STATUS_TRANSITION_DENIED: % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  perform set_config('os.status_change_ok', '1', true);
  update public.os_documents set status = p_to where id = p_document_id returning * into d;
  perform set_config('os.status_change_ok', '', true);
  insert into public.os_document_events (document_id, from_status, to_status, actor_id, note)
  values (p_document_id, v_from, p_to, v_uid, coalesce(p_note, ''));
  return d;
end;
$$;

create or replace function public.os_update_document(
  p_document_id uuid,
  p_expected_version integer,
  p_title text,
  p_content_md text,
  p_folder text,
  p_brand text,
  p_team text,
  p_tags text[],
  p_reason text default ''
) returns public.os_documents
language plpgsql
security invoker
set search_path = public
as $$
declare d public.os_documents;
begin
  select * into d from public.os_documents where id = p_document_id for update;
  if not found then raise exception 'OS_DOC_NOT_FOUND' using errcode = 'P0002'; end if;
  if d.current_version <> p_expected_version then
    raise exception 'OS_VERSION_CONFLICT:%', d.current_version using errcode = 'P0001';
  end if;
  perform set_config('os.version_reason', coalesce(p_reason, ''), true);
  update public.os_documents
  set title = p_title, content_md = p_content_md, folder = p_folder,
      brand = p_brand, team = p_team, tags = coalesce(p_tags, '{}')
  where id = p_document_id
  returning * into d;
  return d;
end;
$$;

create or replace function public.os_get_document_versions(p_document_id uuid)
returns table (
  version_no integer,
  title text,
  content_md text,
  author_id uuid,
  author_name text,
  reason text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select v.version_no, v.title, v.content_md, v.author_id,
         coalesce(p.display_name, p.email, '초기 가져오기') as author_name,
         coalesce(v.reason, ''), v.created_at
  from public.os_document_versions v
  left join public.os_profiles p on p.id = v.author_id
  join public.os_documents d on d.id = v.document_id
  where v.document_id = p_document_id
    and exists (
      select 1 from public.os_profiles me
      where me.id = auth.uid() and me.is_active
        and public.os_can_read_document(d.owner_id, d.status, d.team)
    )
  order by v.version_no desc;
$$;

create or replace function public.os_restore_document_version(
  p_document_id uuid,
  p_version_no integer,
  p_expected_version integer,
  p_reason text default ''
) returns public.os_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.os_documents;
  v public.os_document_versions;
  v_admin boolean := public.os_is_admin();
begin
  select * into d from public.os_documents where id = p_document_id for update;
  if not found then raise exception 'OS_DOC_NOT_FOUND' using errcode = 'P0002'; end if;
  if d.current_version <> p_expected_version then
    raise exception 'OS_VERSION_CONFLICT:%', d.current_version using errcode = 'P0001';
  end if;
  if not (
    v_admin
    or (d.owner_id = auth.uid() and d.status <> 'canonical')
    or (
      d.status = 'canonical'
      and exists (select 1 from public.os_profiles p where p.id = auth.uid() and p.is_active)
    )
  ) then raise exception 'OS_RESTORE_DENIED' using errcode = 'P0001'; end if;

  select * into v from public.os_document_versions
  where document_id = p_document_id and version_no = p_version_no;
  if not found then raise exception 'OS_VERSION_NOT_FOUND' using errcode = 'P0002'; end if;

  perform set_config('os.version_reason', coalesce(nullif(p_reason, ''), format('v%s로 되돌리기', p_version_no)), true);
  update public.os_documents set title = v.title, content_md = v.content_md
  where id = p_document_id returning * into d;
  return d;
end;
$$;

revoke all on function public.os_set_document_status(uuid, public.os_doc_status, text) from public, anon;
revoke all on function public.os_update_document(uuid, integer, text, text, text, text, text, text[], text) from public, anon;
revoke all on function public.os_get_document_versions(uuid) from public, anon;
revoke all on function public.os_restore_document_version(uuid, integer, integer, text) from public, anon;
grant execute on function public.os_set_document_status(uuid, public.os_doc_status, text) to authenticated;
grant execute on function public.os_update_document(uuid, integer, text, text, text, text, text, text[], text) to authenticated;
grant execute on function public.os_get_document_versions(uuid) to authenticated;
grant execute on function public.os_restore_document_version(uuid, integer, integer, text) to authenticated;

commit;
