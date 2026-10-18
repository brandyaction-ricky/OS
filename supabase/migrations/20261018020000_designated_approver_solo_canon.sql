-- Owner decision 2026-10-18: "회사 정본은 내가 관리한다. 내가 승인한 경우는 내 문서와 내 AI
-- 키로 만든 문서도 승인하고 최종 등록할 수 있게."
-- The designated approver (설정 › 회사 › 승인자) may take their own documents, including ones
-- their own AI key drafted, through candidate → review → canonical alone. Two rules still
-- required a second person:
--   1. os_document_candidates check (requested_approver_id <> submitted_by)
--   2. os_publish_candidate's independent-approval rule (approver ≠ publisher / owner / submitter)
-- Both now make an exception only when the approver is the designated approver. Everyone else
-- keeps the old rules, and the canonical-publisher requirement is unchanged.
-- Candidates are written only through os_submit_candidate (authenticated has no insert grant).

alter table public.os_document_candidates drop constraint if exists os_document_candidates_check;

create or replace function public.os_submit_candidate(p_document_id uuid, p_expected_version integer, p_approver uuid, p_folder text, p_steward uuid, p_due date)
 returns public.os_document_candidates
 language plpgsql security definer set search_path to ''
as $function$
declare d public.os_documents; c public.os_document_candidates;
begin
  select * into d from public.os_documents where id=p_document_id for update;
  if not found or not public.os_workspace_page_read(d.id) or not public.os_is_staff() or (d.owner_id<>auth.uid() and not public.os_is_admin()) then raise exception 'OS_CANDIDATE_DENIED' using errcode='42501'; end if;
  if d.status<>'team' or d.current_version<>p_expected_version then raise exception 'OS_VERSION_CONFLICT' using errcode = 'PT409'; end if;
  if not public.os_can_approve(p_approver,d.owner_id) or not public.os_can_approve(p_approver,auth.uid()) or not exists(select 1 from public.os_profiles where id=p_approver and member_kind='staff' and is_active) then raise exception 'OS_APPROVER_INVALID' using errcode='22023'; end if;
  -- Formerly a table check: only the designated approver may name themselves.
  if p_approver = auth.uid() and not public.os_is_designated_approver(p_approver) then raise exception 'OS_APPROVER_INVALID' using errcode='22023'; end if;
  if p_due is null or (p_steward is not null and not exists(select 1 from public.os_profiles where id=p_steward and is_active)) then raise exception 'OS_CANDIDATE_INVALID' using errcode='22023'; end if;
  insert into public.os_document_candidates(document_id,requested_approver_id,target_folder,steward_id,review_due_on,submitted_by)
    values(d.id,p_approver,p_folder,p_steward,p_due,auth.uid()) returning * into c;
  perform public.os_set_document_status(d.id,'review','정본 후보');
  insert into public.os_knowledge_events(actor_id,action,target_type,target_id) values(auth.uid(),'candidate_submit','candidate',c.id);
  return c;
end $function$;

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
  -- Independent approval, except when the approval came from the designated approver.
  if c.decided_by is null or ((c.decided_by=u or c.decided_by=d.owner_id or c.decided_by=c.submitted_by) and not public.os_is_designated_approver(c.decided_by))
    then raise exception 'OS_INDEPENDENT_APPROVAL_REQUIRED' using errcode='42501'; end if;
  perform pg_catalog.set_config('os.status_change_ok','1',true);
  perform pg_catalog.set_config('os.canonical_publish_ok','1',true);
  update public.os_documents set status='canonical',folder=c.target_folder,steward_id=c.steward_id,
    review_due_on=c.review_due_on,retention_hold=true,category_id=null
    where id=d.id returning * into d;
  perform pg_catalog.set_config('os.canonical_publish_ok','',true);
  perform pg_catalog.set_config('os.status_change_ok','',true);
  insert into public.os_document_events(document_id,from_status,to_status,actor_id,note)
    values(d.id,'reviewed','canonical',u,case when c.decided_by=u then '지정 승인자 승인 후 최종 등록' else '독립 검토 후 최종 등록' end);
  insert into public.os_knowledge_events(actor_id,action,target_type,target_id,detail)
    values(u,'candidate_publish','candidate',c.id,jsonb_build_object('approvedBy',c.decided_by));
  return d;
end $function$;
