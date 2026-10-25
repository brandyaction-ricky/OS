-- Move a meeting that went nowhere (a test, an empty agenda) to the trash, with its meeting page.
-- The owner or an admin may do it; a meeting with live decisions or tasks stays, and a page under
-- a retention hold needs an admin. Nothing is deleted: rows keep archived_at, the page keeps
-- archived_from_status, and the event log records who did it and why.
create function public.os_team_archive_meeting(p_id uuid, p_expected_version integer, p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.os_records; u uuid := auth.uid(); reason text := btrim(coalesce(p_reason,''));
begin
  if u is null or not public.os_is_active_member() then raise exception 'OS_ACTIVE_USER_REQUIRED' using errcode='42501'; end if;
  if length(reason) not between 1 and 500 then raise exception 'OS_REASON_REQUIRED' using errcode='22023'; end if;
  select * into m from public.os_records where id=p_id and record_type='meeting' and archived_at is null for update;
  if not found or m.version is distinct from p_expected_version then raise exception 'OS_VERSION_CONFLICT' using errcode='40001'; end if;
  if not ((m.owner_id=u and public.os_can_read_meeting_record(m.id)) or public.os_is_admin()) then raise exception 'OS_MEETING_ARCHIVE_DENIED' using errcode='42501'; end if;
  if exists(select 1 from public.os_records r where r.archived_at is null and r.id<>m.id and r.record_type in ('decision','task')
    and r.status not in ('cancelled','superseded') and (r.parent_id=m.id or r.metadata->>'meetingId'=m.id::text))
    then raise exception 'OS_MEETING_HAS_LINKED_WORK' using errcode='42501'; end if;
  if exists(select 1 from public.os_documents d where d.meeting_record_id=m.id and d.status<>'archived' and (d.retention_hold or d.status='canonical')) and not public.os_is_admin()
    then raise exception 'OS_RETENTION_ADMIN_REQUIRED' using errcode='42501'; end if;
  perform pg_catalog.set_config('os.workspace_meeting_ok','1',true);
  perform pg_catalog.set_config('os.status_change_ok','1',true);
  update public.os_documents set status='archived', archived_at=now(), archived_by=u, archived_from_status=status
    where meeting_record_id=m.id and status<>'archived';
  update public.os_records set archived_at=now(), updated_by=u, metadata=metadata||jsonb_build_object('archivedReason',reason) where id=m.id;
  perform pg_catalog.set_config('os.status_change_ok','',true);
  perform pg_catalog.set_config('os.workspace_meeting_ok','',true);
  insert into public.os_knowledge_events(actor_id,action,target_type,target_id,detail) values(u,'meeting_archive','meeting',m.id,jsonb_build_object('reason',reason));
  return jsonb_build_object('id',m.id,'archived',true);
end $$;
revoke all on function public.os_team_archive_meeting(uuid,integer,text) from public,anon;
grant execute on function public.os_team_archive_meeting(uuid,integer,text) to authenticated;
