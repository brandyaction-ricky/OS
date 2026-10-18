-- Owner decision 2026-10-18: "직원들도 직접 만들고 승인을 해야하는데, 내가 만든 걸 승인 못하는 거
-- 그냥 싹 다 없애줘."
-- Anyone who holds approval authority (the assigned approver, an admin when no approver is assigned,
-- or a valid delegate) may now approve their own work: documents they own, change proposals they or
-- their AI key wrote, candidates they submitted, and content appeal candidates they created.
-- Who holds approval authority does not change, nor do the "named approver decides, admins may
-- proxy with a reason" rule and the canonical-publisher requirement.
-- Not changed: finance refunds (os_fin_refund_command, FINANCE_SELF_APPROVAL), which move money.
-- Every function below is the latest repository definition with only the self-exclusion removed;
-- CREATE OR REPLACE keeps existing privileges. No table, row or grant changes.

-- 1. os_can_approve: drop "p_actor is distinct from p_author". The designated-approver shortcut
--    from 20261014031500 is now implied by the assigned-approver branch. p_author stays in the
--    signature for existing callers and is no longer used.
CREATE OR REPLACE FUNCTION public.os_can_approve(p_actor uuid, p_author uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    p_actor is not null
    and exists (
      select 1 from public.os_profiles actor
      where actor.id = p_actor and actor.is_active
    )
    and (
      exists (
        select 1 from public.os_approval_assignments approval
        where approval.user_id = p_actor and approval.kind = 'approver'
          and approval.revoked_at is null
          and (approval.starts_on is null or approval.starts_on <= current_date)
          and (approval.ends_on is null or approval.ends_on >= current_date)
      )
      or (
        not exists (
          select 1 from public.os_approval_assignments approval
          join public.os_profiles approver_profile on approver_profile.id = approval.user_id and approver_profile.is_active
          where approval.kind = 'approver' and approval.revoked_at is null
            and (approval.starts_on is null or approval.starts_on <= current_date)
            and (approval.ends_on is null or approval.ends_on >= current_date)
        )
        and exists (
          select 1 from public.os_profiles actor
          where actor.id = p_actor and actor.role = 'admin' and actor.is_active
        )
      )
      or exists (
        select 1 from public.os_approval_assignments delegation
        join public.os_profiles delegator on delegator.id = delegation.delegated_by
        where delegation.kind = 'delegate' and delegation.user_id = p_actor
          and delegation.revoked_at is null and current_date between delegation.starts_on and delegation.ends_on
          and delegator.is_active
          and (
            exists (
              select 1 from public.os_approval_assignments approval
              where approval.kind = 'approver' and approval.user_id = delegation.delegated_by
                and approval.revoked_at is null
                and (approval.starts_on is null or approval.starts_on <= current_date)
                and (approval.ends_on is null or approval.ends_on >= current_date)
            )
            or (
              delegator.role = 'admin'
              and not exists (
                select 1 from public.os_approval_assignments approval
                join public.os_profiles approver_profile on approver_profile.id = approval.user_id and approver_profile.is_active
                where approval.kind = 'approver' and approval.revoked_at is null
                  and (approval.starts_on is null or approval.starts_on <= current_date)
                  and (approval.ends_on is null or approval.ends_on >= current_date)
              )
            )
          )
      )
    ), false
  );
$function$;

-- 2. os_knowledge_workflow_command (definition from 20261013060000): proposal.decide no longer
--    excludes the proposal author, the document owner or the owner of the AI key that wrote it.
CREATE OR REPLACE FUNCTION public.os_knowledge_workflow_command(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a text:=p->>'action'; u uuid:=auth.uid(); rid uuid:=nullif(p->>'id','')::uuid;
  d public.os_documents; prop public.os_document_proposals; m public.os_records;
  item jsonb; meta jsonb; approver uuid; next_status text; changed boolean;
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
    if not (a='proposal.rebase' and prop.author_id=u) and (
      not public.os_is_staff()
      or not public.os_can_approve(u,prop.author_id)
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

-- 3. os_submit_candidate (definition from 20261018020000): anyone may name themselves as approver
--    when they hold approval authority.
create or replace function public.os_submit_candidate(p_document_id uuid, p_expected_version integer, p_approver uuid, p_folder text, p_steward uuid, p_due date)
 returns public.os_document_candidates
 language plpgsql security definer set search_path to ''
as $function$
declare d public.os_documents; c public.os_document_candidates;
begin
  select * into d from public.os_documents where id=p_document_id for update;
  if not found or not public.os_workspace_page_read(d.id) or not public.os_is_staff() or (d.owner_id<>auth.uid() and not public.os_is_admin()) then raise exception 'OS_CANDIDATE_DENIED' using errcode='42501'; end if;
  if d.status<>'team' or d.current_version<>p_expected_version then raise exception 'OS_VERSION_CONFLICT' using errcode = 'PT409'; end if;
  if not public.os_can_approve(p_approver,d.owner_id) or not exists(select 1 from public.os_profiles where id=p_approver and member_kind='staff' and is_active) then raise exception 'OS_APPROVER_INVALID' using errcode='22023'; end if;
  if p_due is null or (p_steward is not null and not exists(select 1 from public.os_profiles where id=p_steward and is_active)) then raise exception 'OS_CANDIDATE_INVALID' using errcode='22023'; end if;
  insert into public.os_document_candidates(document_id,requested_approver_id,target_folder,steward_id,review_due_on,submitted_by)
    values(d.id,p_approver,p_folder,p_steward,p_due,auth.uid()) returning * into c;
  perform public.os_set_document_status(d.id,'review','정본 후보');
  insert into public.os_knowledge_events(actor_id,action,target_type,target_id) values(auth.uid(),'candidate_submit','candidate',c.id);
  return c;
end $function$;

-- 4. os_publish_candidate (definition from 20261018020000): the candidate must still be approved and
--    published by the canonical publisher, but the approver may be the publisher, owner or submitter.
create or replace function public.os_publish_candidate(p_id uuid, p_expected_version integer)
 returns public.os_documents
 language plpgsql security definer set search_path to ''
as $function$
declare c public.os_document_candidates; d public.os_documents; u uuid:=auth.uid();
begin
  select * into c from public.os_document_candidates where id=p_id;
  if not found or c.status<>'approved' then raise exception 'OS_CANDIDATE_NOT_APPROVED' using errcode='42501'; end if;
  select * into d from public.os_documents where id=c.document_id for update;
  select * into c from public.os_document_candidates where id=p_id for update;
  if not found or c.status<>'approved' or d.status<>'reviewed' or d.current_version is distinct from p_expected_version
    then raise exception 'OS_CANDIDATE_CHANGED' using errcode = 'PT409'; end if;
  if not public.os_workspace_page_read(d.id) or not exists (
    select 1 from public.os_profiles p where p.id=u and p.is_active
      and p.member_kind='staff' and p.role='admin' and p.canonical_publisher
  ) then raise exception 'OS_CANONICAL_PUBLISHER_REQUIRED' using errcode='42501'; end if;
  if c.decided_by is null then raise exception 'OS_CANDIDATE_NOT_APPROVED' using errcode='42501'; end if;
  perform pg_catalog.set_config('os.status_change_ok','1',true);
  perform pg_catalog.set_config('os.canonical_publish_ok','1',true);
  update public.os_documents set status='canonical',folder=c.target_folder,steward_id=c.steward_id,
    review_due_on=c.review_due_on,retention_hold=true,category_id=null
    where id=d.id returning * into d;
  perform pg_catalog.set_config('os.canonical_publish_ok','',true);
  perform pg_catalog.set_config('os.status_change_ok','',true);
  insert into public.os_document_events(document_id,from_status,to_status,actor_id,note)
    values(d.id,'reviewed','canonical',u,'승인 후 최종 등록');
  insert into public.os_knowledge_events(actor_id,action,target_type,target_id,detail)
    values(u,'candidate_publish','candidate',c.id,jsonb_build_object('approvedBy',c.decided_by));
  return d;
end $function$;
