-- Same read rules, evaluated cheaply.
-- Row policies called security-definer functions per row that re-selected the
-- row and re-read the caller's profile several times (about 1 ms per row).
-- The caller's flags are now InitPlans evaluated once per query, the row's own
-- columns are used directly, and only rows with a parent / meeting link / note
-- grant / partner category reach a table lookup. Existing functions keep their
-- signatures and bodies for every other caller. No data, grant or table change.

-- Ancestors of a page with the original chain limits (64 nodes including the
-- page itself; a cycle or dangling parent fails closed).
create or replace function public.os_workspace_ancestors_read(p_parent uuid) returns boolean
language sql stable security definer set search_path='' as $$
  with recursive chain as (
    select d.id,d.parent_document_id,array[d.id] as visited,false as cycle from public.os_documents d where d.id=p_parent
    union all
    select d.id,d.parent_document_id,c.visited||d.id,d.id=any(c.visited) from public.os_documents d join chain c on d.id=c.parent_document_id
    where not c.cycle and cardinality(c.visited)<63
  ) select coalesce(bool_and(public.os_workspace_document_read(id) and not cycle) and bool_or(parent_document_id is null),false) from chain
$$;

create or replace function public.os_workspace_partner_category(p_category uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.os_doc_categories c where c.id=p_category and c.archived_at is null and auth.uid()=any(c.partner_ids))
$$;

-- Exact row form of os_workspace_document_read; the caller passes its own flags.
create or replace function public.os_workspace_document_row_read(
  p_id uuid, p_status public.os_doc_status, p_owner uuid, p_source text, p_archived_from public.os_doc_status,
  p_archived_by uuid, p_meeting uuid, p_category uuid, p_uid uuid, p_active boolean, p_partner boolean, p_admin boolean
) returns boolean language sql stable set search_path='' as $$
  select coalesce(p_active and case
    when p_partner and p_source='mcp' and (case when p_status='archived' then coalesce(p_archived_from,'draft') else p_status end)<>'canonical' then false
    when p_meeting is not null and not public.os_can_read_meeting_record(p_meeting) then false
    when p_status='draft' or (p_status='archived' and coalesce(p_archived_from,'draft')='draft') then p_owner=p_uid or public.os_has_note_access(p_id)
    when p_status='archived' then p_owner=p_uid or p_archived_by=p_uid or p_admin
    when p_meeting is not null then true
    when p_status='canonical' then true
    when p_partner then p_source<>'mcp' and (p_owner=p_uid or public.os_workspace_partner_category(p_category))
    else p_status in ('team','review','reviewed') end,false)
$$;

create or replace function public.os_workspace_record_parent_read(p_parent uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select case when exists(select 1 from public.os_records p where p.id=p_parent and p.record_type='meeting' and p.metadata->>'workspace'='knowledge')
    then public.os_can_read_meeting_record(p_parent) else true end
$$;

revoke all on function public.os_workspace_ancestors_read(uuid),public.os_workspace_partner_category(uuid),public.os_workspace_record_parent_read(uuid),
  public.os_workspace_document_row_read(uuid,public.os_doc_status,uuid,text,public.os_doc_status,uuid,uuid,uuid,uuid,boolean,boolean,boolean) from public,anon;
grant execute on function public.os_workspace_ancestors_read(uuid),public.os_workspace_partner_category(uuid),public.os_workspace_record_parent_read(uuid),
  public.os_workspace_document_row_read(uuid,public.os_doc_status,uuid,text,public.os_doc_status,uuid,uuid,uuid,uuid,boolean,boolean,boolean) to authenticated,service_role;

-- os_can_read_document(owner_id,status,team) with the caller's flags hoisted.
alter policy os_documents_select on public.os_documents using (
  (select auth.uid()) is not null and ((select public.os_is_admin()) or owner_id=(select auth.uid())
    or (status<>'draft' and (status<>'team' or (select public.os_is_active_member()))))
);
-- os_workspace_page_read(id): the row itself, then its ancestors only when it has a parent.
alter policy workspace_documents_read on public.os_documents using (
  public.os_workspace_document_row_read(id,status,owner_id,source,archived_from_status,archived_by,meeting_record_id,category_id,
    (select auth.uid()),(select public.os_is_active_member()),(select public.os_is_partner()),(select public.os_is_admin()))
  and (parent_document_id is null or (parent_document_id<>id and public.os_workspace_ancestors_read(parent_document_id)))
);
-- os_workspace_record_read(id) from the row's own columns.
alter policy workspace_meetings_read on public.os_records using (
  case
    when record_type='meeting' and metadata->>'workspace'='knowledge' then public.os_can_read_meeting_record(id)
    when record_type in ('decision','task') and parent_id is not null then public.os_workspace_record_parent_read(parent_id)
    else true end
);
alter policy os_records_active_select on public.os_records using (
  (select public.os_is_active_member()) and ((record_type <> all (array['expense','contract','subscription','company_document'])) or (select public.os_has_finance_access()))
);
