-- Same document read rules, written where the planner can see them.
-- workspace_documents_read called os_workspace_document_row_read() for every document row. Postgres runs it as
-- a separate call each time (its SET clause, and arguments such as (select auth.uid()) used more than once in
-- its body, both stop inlining): about 0.19 ms per row, 1.1 s for ~6000 rows, even for a query that wants one
-- folder. Both policies also called os_canonical_reader() once per draft row.
-- Now the identical CASE sits in the policy itself, the caller's flags are InitPlans evaluated once, and the
-- caller's reader list is one array per query (like the note grants). Measured on Production read-only, the
-- inline form took 14 ms over every document. The old functions keep their signatures for any other caller.
-- No data, grant or table change.
begin;

-- Documents the caller was named a reader of, once per query.
create or replace function public.os_my_reader_documents() returns uuid[]
language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(document_id), '{}') from public.os_document_readers where user_id = auth.uid()
$$;
revoke all on function public.os_my_reader_documents() from public, anon;
grant execute on function public.os_my_reader_documents() to authenticated, service_role;

alter policy os_documents_select on public.os_documents using (
  (select auth.uid()) is not null and ((select public.os_is_admin()) or owner_id = (select auth.uid())
    or (status <> 'draft' and (status <> 'team' or (select public.os_is_active_member())))
    or (status = 'draft' and id = any(coalesce((select public.os_my_reader_documents()), '{}'::uuid[]))))
);

-- os_workspace_document_row_read(...) with p_uid/p_active/p_partner/p_admin/p_grants as InitPlans and
-- os_canonical_reader(id) as membership in the reader array.
alter policy workspace_documents_read on public.os_documents using (
  coalesce((select public.os_is_active_member()) and case
    when (select public.os_is_partner()) and source = 'mcp' and (case when status = 'archived' then coalesce(archived_from_status, 'draft') else status end) <> 'canonical' then false
    when meeting_record_id is not null and not public.os_can_read_meeting_record(meeting_record_id) then false
    when status = 'draft' then owner_id = (select auth.uid()) or ((select public.os_is_admin()) and id = any(coalesce((select public.os_workspace_my_note_grants()), '{}'::uuid[])))
      or id = any(coalesce((select public.os_my_reader_documents()), '{}'::uuid[]))
    when status = 'archived' and coalesce(archived_from_status, 'draft') = 'draft' then owner_id = (select auth.uid())
      or ((select public.os_is_admin()) and id = any(coalesce((select public.os_workspace_my_note_grants()), '{}'::uuid[])))
    when status = 'archived' then owner_id = (select auth.uid()) or archived_by = (select auth.uid()) or (select public.os_is_admin())
    when status = 'canonical' and coalesce(reader_scope, 'all') <> 'all' then (select public.os_is_admin()) or owner_id = (select auth.uid())
      or steward_id = (select auth.uid()) or id = any(coalesce((select public.os_my_reader_documents()), '{}'::uuid[]))
    when meeting_record_id is not null then true
    when status = 'canonical' then true
    when (select public.os_is_partner()) then source <> 'mcp' and (owner_id = (select auth.uid()) or public.os_workspace_partner_category(category_id))
    else status in ('team', 'review', 'reviewed') end, false)
  and (parent_document_id is null or (parent_document_id <> id and public.os_workspace_ancestors_read(parent_document_id)))
);

commit;
