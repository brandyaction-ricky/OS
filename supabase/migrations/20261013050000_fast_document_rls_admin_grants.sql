-- Admins still looked up a note grant for every private draft they do not own
-- (~4k rows, ~1 s per document query). The caller's active grants are now read
-- once per query and passed in, like the other caller flags. Same result as
-- os_has_note_access: an admin with an unexpired grant on that document.
create or replace function public.os_workspace_my_note_grants() returns uuid[]
language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(document_id),'{}') from public.os_note_access_grants where admin_id=auth.uid() and expires_at>now()
$$;
revoke all on function public.os_workspace_my_note_grants() from public,anon;
grant execute on function public.os_workspace_my_note_grants() to authenticated,service_role;

create or replace function public.os_workspace_document_row_read(
  p_id uuid, p_status public.os_doc_status, p_owner uuid, p_source text, p_archived_from public.os_doc_status,
  p_archived_by uuid, p_meeting uuid, p_category uuid, p_uid uuid, p_active boolean, p_partner boolean, p_admin boolean, p_grants uuid[]
) returns boolean language sql stable set search_path='' as $$
  select coalesce(p_active and case
    when p_partner and p_source='mcp' and (case when p_status='archived' then coalesce(p_archived_from,'draft') else p_status end)<>'canonical' then false
    when p_meeting is not null and not public.os_can_read_meeting_record(p_meeting) then false
    when p_status='draft' or (p_status='archived' and coalesce(p_archived_from,'draft')='draft') then p_owner=p_uid or (p_admin and p_id=any(p_grants))
    when p_status='archived' then p_owner=p_uid or p_archived_by=p_uid or p_admin
    when p_meeting is not null then true
    when p_status='canonical' then true
    when p_partner then p_source<>'mcp' and (p_owner=p_uid or public.os_workspace_partner_category(p_category))
    else p_status in ('team','review','reviewed') end,false)
$$;
revoke all on function public.os_workspace_document_row_read(uuid,public.os_doc_status,uuid,text,public.os_doc_status,uuid,uuid,uuid,uuid,boolean,boolean,boolean,uuid[]) from public,anon;
grant execute on function public.os_workspace_document_row_read(uuid,public.os_doc_status,uuid,text,public.os_doc_status,uuid,uuid,uuid,uuid,boolean,boolean,boolean,uuid[]) to authenticated,service_role;

alter policy workspace_documents_read on public.os_documents using (
  public.os_workspace_document_row_read(id,status,owner_id,source,archived_from_status,archived_by,meeting_record_id,category_id,
    (select auth.uid()),(select public.os_is_active_member()),(select public.os_is_partner()),(select public.os_is_admin()),
    (select public.os_workspace_my_note_grants()))
  and (parent_document_id is null or (parent_document_id<>id and public.os_workspace_ancestors_read(parent_document_id)))
);
-- The 12-argument form was only used by the policy above.
drop function public.os_workspace_document_row_read(uuid,public.os_doc_status,uuid,text,public.os_doc_status,uuid,uuid,uuid,uuid,boolean,boolean,boolean);
