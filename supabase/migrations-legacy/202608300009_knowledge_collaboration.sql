begin;

-- Knowledge documents are shared working memory. Scope is a UI default, not a
-- security boundary: every active member and internal AI may search all docs.
create or replace function public.os_can_read_document(
  p_owner uuid,
  p_status public.os_doc_status,
  p_team text
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.os_profiles p
    where p.id = auth.uid() and p.is_active
  );
$$;

drop policy if exists os_documents_active_member_select on public.os_documents;
create policy os_documents_active_member_select on public.os_documents
  for select to authenticated
  using (public.os_is_active_member());

commit;
