-- The explicitly assigned approver (Members > 승인자) manages company canonical documents.
-- They may decide change proposals even on documents they own or that their own AI key drafted.
-- Everyone else, including admins acting as fallback approvers and delegates, keeps the
-- author / document owner / AI key owner exclusion. Only proposal.decide is affected.
-- os_knowledge_workflow_command below is the 2026-10-13 Production definition (identical on DEV)
-- with only that condition changed.

create or replace function public.os_is_designated_approver(p_actor uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    p_actor is not null
    and exists (select 1 from public.os_profiles actor where actor.id = p_actor and actor.is_active and actor.member_kind = 'staff')
    and exists (
      select 1 from public.os_approval_assignments approval
      where approval.user_id = p_actor and approval.kind = 'approver' and approval.revoked_at is null
        and (approval.starts_on is null or approval.starts_on <= current_date)
        and (approval.ends_on is null or approval.ends_on >= current_date)
    ), false);
$$;
revoke all on function public.os_is_designated_approver(uuid) from public, anon;
grant execute on function public.os_is_designated_approver(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.os_knowledge_workflow_command(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a text:=p->>'action'; u uuid:=auth.uid(); rid uuid:=nullif(p->>'id','')::uuid;
  d public.os_documents; prop public.os_document_proposals; m public.os_records;
  item jsonb; meta jsonb; approver uuid; agent_owner uuid; next_status text; changed boolean;
  result_id uuid; attendee uuid; expected integer:=(p->>'expectedVersion')::integer;
begin
  if u is null or not public.os_is_active_member() then raise exception 'OS_ACTIVE_USER_REQUIRED' using errcode='42501'; end if;
  if octet_length(p::text)>2000000 then raise exception 'OS_COMMAND_TOO_LARGE' using errcode='22023'; end if;
  if a='proposal.create' then
    select * into d from public.os_documents where id=rid for update;
    if not found or d.status<>'canonical' or not public.os_workspace_page_read(d.id) then raise exception 'OS_DOCUMENT_NOT_FOUND' using errcode='P0002'; end if;
    approver:=(p->>'approverId')::uuid;
    if length(btrim(coalesce(p->>'reason',''))) not between 1 and 200 or expected is null or expected<1
      or not public.os_can_approve(approver,u) or not public.os_can_approve(approver,d.owner_id)
      or not exists(select 1 from public.os_profiles where id=approver and is_active and member_kind='staff') then raise exception 'OS_PROPOSAL_INVALID' using errcode='22023'; end if;
    if nullif(p->>'proposalId','') is not null then
      select * into prop from public.os_document_proposals where id=(p->>'proposalId')::uuid for update;
      if not found or prop.document_id<>d.id or prop.author_id<>u or prop.status<>'returned' or prop.return_kind<>'revise' then raise exception 'OS_PROPOSAL_REVISE_DENIED' using errcode='42501'; end if;
      update public.os_document_proposals set base_version=expected,title=coalesce(p->>'title',d.title),content_md=coalesce(p->>'content',d.content_md),
        folder=coalesce(p->>'folder',d.folder),tags=case when p?'tags' then array(select jsonb_array_elements_text(p->'tags')) else d.tags end,
        review_due_on=coalesce(nullif(p->>'reviewDueOn','')::date,d.review_due_on),requested_approver_id=approver,author_note=btrim(p->>'reason'),ai_assist=coalesce(p->>'aiAssist',''),
        status='open',return_kind=null,reviewer_id=null,decided_at=null,note='',updated_at=now() where id=prop.id returning id into rid;
    else
      insert into public.os_document_proposals(document_id,base_version,title,content_md,folder,brand,team,tags,author_id,requested_approver_id,author_note,ai_assist,review_due_on)
        values(d.id,expected,coalesce(p->>'title',d.title),coalesce(p->>'content',d.content_md),coalesce(p->>'folder',d.folder),coalesce(d.brand,''),d.team,
          case when p?'tags' then array(select jsonb_array_elements_text(p->'tags')) else d.tags end,u,approver,btrim(p->>'reason'),coalesce(p->>'aiAssist',''),coalesce(nullif(p->>'reviewDueOn','')::date,d.review_due_on)) returning id into rid;
    end if;
    delete from public.os_document_drafts where document_id=d.id and user_id=u and updated_at<=now();
  elsif a in ('proposal.decide','proposal.rebase') then
    select * into prop from public.os_document_proposals where id=rid;
    if not found then raise exception 'OS_PROPOSAL_NOT_FOUND' using errcode='P0002'; end if;
    select * into d from public.os_documents where id=prop.document_id for update;
    select * into prop from public.os_document_proposals where id=rid for update;
    if prop.status<>'open' or d.status<>'canonical' or not public.os_workspace_page_read(d.id) then raise exception 'OS_PROPOSAL_NOT_OPEN' using errcode='P0002'; end if;
    if a='proposal.decide' and p->>'decision'='withdrawn' then
      if prop.author_id<>u then raise exception 'OS_PROPOSAL_DENIED' using errcode='42501'; end if;
      update public.os_document_proposals set status='withdrawn',updated_at=now(),decided_at=now(),reviewer_id=u where id=rid;
      return jsonb_build_object('id',rid);
    end if;
    if prop.agent_key_id is not null then select owner_user_id into agent_owner from public.os_agent_keys where id=prop.agent_key_id; end if;
    if not (a='proposal.rebase' and prop.author_id=u) and (
      not public.os_is_staff()
      or (not (a='proposal.decide' and public.os_is_designated_approver(u))
        and (not public.os_can_approve(u,prop.author_id) or not public.os_can_approve(u,d.owner_id) or u=agent_owner))
      or (prop.requested_approver_id is not null and prop.requested_approver_id<>u and not(public.os_is_admin() and length(btrim(coalesce(p->>'reason','')))>0))
    ) then raise exception 'OS_PROPOSAL_DENIED' using errcode='42501'; end if;
    if a='proposal.rebase' then
      if d.current_version is distinct from expected then raise exception 'OS_VERSION_CONFLICT' using errcode = 'PT409'; end if;
      update public.os_document_proposals set rebased_from_version=base_version,base_version=d.current_version,title=coalesce(p->>'title',title),content_md=coalesce(p->>'content',content_md),
        folder=coalesce(p->>'folder',folder),brand=coalesce(p->>'brand',brand),team=coalesce(p->>'team',team),tags=case when p?'tags' then array(select jsonb_array_elements_text(p->'tags')) else tags end,
        review_due_on=case when p?'reviewDueOn' then nullif(p->>'reviewDueOn','')::date else review_due_on end,updated_at=now() where id=rid;
    elsif p->>'decision'='approved' then
      if d.current_version<>prop.base_version then raise exception 'OS_VERSION_CONFLICT' using errcode = 'PT409'; end if;
      changed:=(d.title,d.content_md) is distinct from (prop.title,prop.content_md);
      perform pg_catalog.set_config('os.proposal_apply_ok','1',true);
      perform pg_catalog.set_config('os.version_reason','승인된 변경 제안',true);
      update public.os_documents set title=prop.title,content_md=prop.content_md,folder=prop.folder,brand=prop.brand,team=prop.team,tags=prop.tags,review_due_on=prop.review_due_on,
        current_version=case when changed then d.current_version else d.current_version+1 end where id=d.id returning * into d;
      if not changed then insert into public.os_document_versions(document_id,version_no,title,content_md,author_id,reason) values(d.id,d.current_version,d.title,d.content_md,u,'승인된 문서 속성 제안'); end if;
      perform pg_catalog.set_config('os.proposal_apply_ok','',true);
      update public.os_document_proposals set status='approved',reviewer_id=u,decided_at=now(),note=coalesce(p->>'reason',''),proxy_reason=case when requested_approver_id is not null and requested_approver_id<>u then p->>'reason' else '' end,updated_at=now() where id=rid;
    elsif p->>'decision' in ('returned','rejected') and length(btrim(coalesce(p->>'reason','')))>0 then
      update public.os_document_proposals set status='returned',return_kind=case when p->>'decision'='rejected' then 'reject' else 'revise' end,reviewer_id=u,decided_at=now(),note=p->>'reason',updated_at=now() where id=rid;
    else raise exception 'OS_DECISION_INVALID' using errcode='22023'; end if;
  elsif a='meeting.create' then
    if not public.os_is_active_member() then raise exception 'OS_MEETING_CREATE_DENIED' using errcode='42501'; end if;
    perform pg_catalog.set_config('os.workspace_meeting_ok','1',true);
    meta:=jsonb_build_object('workspace','knowledge','visibility',case when public.os_is_partner() or p->>'visibility'='attendees' or p->>'templateName'='1:1' then 'attendees' else 'team' end,'agenda',coalesce(p->>'content',''),'items','[]'::jsonb);
    if nullif(p->>'previousMeetingId','') is not null then
      select * into m from public.os_records where id=(p->>'previousMeetingId')::uuid and status='done' and metadata->>'workspace'='knowledge';
      if not found or not public.os_can_read_meeting_record(m.id) then raise exception 'OS_MEETING_NOT_FOUND' using errcode='P0002'; end if;
      meta:=meta||jsonb_build_object('previousMeetingId',m.id,'visibility',case when public.os_is_partner() then 'attendees' else m.metadata->>'visibility' end,'agenda',m.metadata->>'agenda',
        'items',coalesce((select jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'kind','task','text',t.title,'state','pending','ownerId',t.assignee_id,'dueOn',t.due_date)) from public.os_records t where t.parent_id=m.id and t.record_type='task' and t.archived_at is null and t.status not in ('done','cancelled')), '[]'::jsonb));
    end if;
    insert into public.os_records(record_type,title,description,status,owner_id,created_by,updated_by,starts_at,metadata)
      values('meeting',coalesce(nullif(btrim(p->>'title'),''),'회의 — '||(now() at time zone 'Asia/Seoul')::date::text),'','planned',u,u,u,nullif(p->>'startsAt','')::timestamptz,meta) returning id into rid;
    insert into public.os_meeting_attendees(meeting_id,user_id,added_by) values(rid,u,u);
    if m.id is not null then
      insert into public.os_meeting_attendees(meeting_id,user_id,added_by) select rid,a.user_id,u from public.os_meeting_attendees a join public.os_profiles profile on profile.id=a.user_id and profile.is_active where a.meeting_id=m.id on conflict do nothing;
    end if;
    insert into public.os_documents(title,content_md,folder,status,source,owner_id,created_by,meeting_record_id)
      select title,'','','team','wiki',u,u,rid from public.os_records where id=rid;
    perform pg_catalog.set_config('os.workspace_meeting_ok','',true);
  elsif a in ('meeting.save','meeting.start','meeting.finish','meeting.review','meeting.correct') then
    select * into m from public.os_records where id=rid and record_type='meeting' and metadata->>'workspace'='knowledge' and archived_at is null for update;
    if not found or not public.os_can_read_meeting_record(m.id) then raise exception 'OS_MEETING_NOT_FOUND' using errcode='P0002'; end if;
    if m.version is distinct from expected then raise exception 'OS_VERSION_CONFLICT' using errcode = 'PT409'; end if;
    if not exists(select 1 from public.os_meeting_attendees where meeting_id=m.id and user_id=u) and not public.os_is_admin() then raise exception 'OS_MEETING_DENIED' using errcode='42501'; end if;
    perform pg_catalog.set_config('os.workspace_meeting_ok','1',true);
    meta:=m.metadata;
    if a='meeting.correct' then
      if m.status<>'done' or not(m.owner_id=u or public.os_is_admin()) or length(btrim(coalesce(p->>'reason','')))=0 or length(btrim(coalesce(p->>'content','')))=0 then raise exception 'OS_CORRECTION_DENIED' using errcode='42501'; end if;
      meta:=jsonb_set(meta,'{corrections}',coalesce(meta->'corrections','[]'::jsonb)||jsonb_build_array(jsonb_build_object('text',p->>'content','reason',p->>'reason','at',now(),'by',u)));
      update public.os_records set metadata=meta where id=m.id;
    else
      if m.status='done' then raise exception 'OS_MEETING_LOCKED' using errcode='42501'; end if;
      next_status:=m.status;
      if a='meeting.start' then
        if m.status<>'planned' then raise exception 'OS_MEETING_STATE' using errcode='22023'; end if; next_status:='active';
      elsif a='meeting.finish' then
        if m.status<>'active' then raise exception 'OS_MEETING_STATE' using errcode='22023'; end if; next_status:='review';
      elsif a='meeting.review' then
        if m.status<>'review' or not(m.owner_id=u or public.os_is_admin()) or exists(select 1 from jsonb_array_elements(meta->'items') i where i->>'state'='pending') then raise exception 'OS_MEETING_REVIEW_DENIED' using errcode='42501'; end if;
        next_status:='done'; meta:=meta||jsonb_build_object('reviewedBy',u,'reviewedAt',now());
        for item in select value from jsonb_array_elements(meta->'items') where value->>'state'='accepted' loop
          if coalesce(item->>'kind','') not in ('decision','task') or length(btrim(coalesce(item->>'text','')))=0 then raise exception 'OS_MEETING_ITEM_INVALID' using errcode='22023'; end if;
          insert into public.os_records(record_type,title,description,status,parent_id,owner_id,created_by,updated_by,assignee_id,due_date,metadata)
            values(item->>'kind',left(item->>'text',240),item->>'text',case when item->>'kind'='decision' then 'confirmed' else 'todo' end,m.id,u,u,u,nullif(item->>'ownerId','')::uuid,nullif(item->>'dueOn','')::date,jsonb_build_object('workspace','knowledge','meetingItemId',item->>'id','confirmedAt',now())) returning id into result_id;
        end loop;
      elsif a='meeting.save' then
        if m.status='review' and not(m.owner_id=u or public.os_is_admin()) then raise exception 'OS_MEETING_REVIEW_LOCKED' using errcode='42501'; end if;
        if p?'items' then
          if jsonb_typeof(p->'items')<>'array' or jsonb_array_length(p->'items')>100 then raise exception 'OS_MEETING_ITEMS_INVALID' using errcode='22023'; end if;
          for item in select value from jsonb_array_elements(p->'items') loop
            if coalesce(item->>'kind','') not in ('decision','task') or coalesce(item->>'state','') not in ('pending','accepted','discarded') or length(btrim(coalesce(item->>'text','')))=0 then raise exception 'OS_MEETING_ITEM_INVALID' using errcode='22023'; end if;
          end loop;
          meta:=jsonb_set(meta,'{items}',p->'items');
        end if;
        if p?'agenda' then meta:=jsonb_set(meta,'{agenda}',p->'agenda'); end if;
        if p?'summary' then meta:=jsonb_set(meta,'{summary}',p->'summary'); end if;
        if p?'attendees' or p?'visibility' then
          if not(m.owner_id=u or public.os_is_admin()) then raise exception 'OS_MEETING_OWNER_REQUIRED' using errcode='42501'; end if;
          if p?'visibility' then
            if p->>'visibility' not in ('team','attendees') or (p->>'visibility'='team' and public.os_is_partner()) then raise exception 'OS_VISIBILITY_INVALID' using errcode='22023'; end if;
            meta:=jsonb_set(meta,'{visibility}',p->'visibility');
          end if;
          if p?'attendees' then
            delete from public.os_meeting_attendees where meeting_id=m.id and user_id<>m.owner_id;
            for attendee in select distinct jsonb_array_elements_text(p->'attendees')::uuid loop
              if not exists(select 1 from public.os_profiles where id=attendee and is_active) then raise exception 'OS_ATTENDEE_INVALID' using errcode='22023'; end if;
              insert into public.os_meeting_attendees(meeting_id,user_id,added_by) values(m.id,attendee,u) on conflict do nothing;
            end loop;
          end if;
        end if;
      end if;
      update public.os_records set title=coalesce(nullif(btrim(p->>'title'),''),title),description=coalesce(p->>'content',description),
        status=next_status,metadata=meta,starts_at=case when a='meeting.start' then now() when p?'startsAt' then nullif(p->>'startsAt','')::timestamptz else starts_at end,
        ends_at=case when a='meeting.finish' then now() else ends_at end where id=m.id returning * into m;
      update public.os_documents set title=m.title,content_md=coalesce(meta->>'agenda','')||E'\n\n'||m.description,retention_hold=retention_hold or next_status='done' where meeting_record_id=m.id;
    end if;
    perform pg_catalog.set_config('os.workspace_meeting_ok','',true);
  else raise exception 'OS_UNKNOWN_COMMAND' using errcode='22023';
  end if;
  insert into public.os_knowledge_events(actor_id,action,target_type,target_id,detail) values(u,replace(a,'.','_'),case when a like 'meeting.%' then 'meeting' else 'proposal' end,rid,'{}');
  return jsonb_build_object('id',rid);
end $function$;
