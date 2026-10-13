-- Most documents are other members' private drafts. For each of them the row
-- policy called os_has_note_access(id), which re-reads the caller's role before
-- looking up a note grant. Only an admin can hold a grant, and the policy
-- already passes the caller's admin flag, so non-admins skip the lookup and
-- admins check the grant table directly. Same result as os_has_note_access.
create or replace function public.os_workspace_note_grant(p_document uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.os_note_access_grants where document_id=p_document and admin_id=auth.uid() and expires_at>now())
$$;
revoke all on function public.os_workspace_note_grant(uuid) from public,anon;
grant execute on function public.os_workspace_note_grant(uuid) to authenticated,service_role;

create or replace function public.os_workspace_document_row_read(
  p_id uuid, p_status public.os_doc_status, p_owner uuid, p_source text, p_archived_from public.os_doc_status,
  p_archived_by uuid, p_meeting uuid, p_category uuid, p_uid uuid, p_active boolean, p_partner boolean, p_admin boolean
) returns boolean language sql stable set search_path='' as $$
  select coalesce(p_active and case
    when p_partner and p_source='mcp' and (case when p_status='archived' then coalesce(p_archived_from,'draft') else p_status end)<>'canonical' then false
    when p_meeting is not null and not public.os_can_read_meeting_record(p_meeting) then false
    when p_status='draft' or (p_status='archived' and coalesce(p_archived_from,'draft')='draft') then p_owner=p_uid or (p_admin and public.os_workspace_note_grant(p_id))
    when p_status='archived' then p_owner=p_uid or p_archived_by=p_uid or p_admin
    when p_meeting is not null then true
    when p_status='canonical' then true
    when p_partner then p_source<>'mcp' and (p_owner=p_uid or public.os_workspace_partner_category(p_category))
    else p_status in ('team','review','reviewed') end,false)
$$;
