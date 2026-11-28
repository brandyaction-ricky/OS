-- 정본 요청·검토 간편화 (대표 2026-11-28): additive only.
-- 1. A canon request carries one line of why (submit_note), written by the person who asked.
-- 2. The approver's decision remembers the document version it saw (approved_version). Final
--    registration only goes through on that same version; if the text changed after the
--    approval, the approver approves again (a re-decision of an approved candidate).

alter table public.os_document_candidates
  add column if not exists submit_note text not null default '',
  add column if not exists approved_version integer;

do $$ begin
  alter table public.os_document_candidates add constraint os_document_candidates_submit_note_len check (char_length(submit_note) <= 300);
exception when duplicate_object then null; end $$;

-- The submitter (or an admin) writes the why line while the request is open.
create or replace function public.os_candidate_note(p_id uuid, p_note text)
 returns public.os_document_candidates
 language plpgsql security definer set search_path to ''
as $function$
declare c public.os_document_candidates;
begin
  select * into c from public.os_document_candidates where id=p_id for update;
  if not found or c.status<>'open' or (c.submitted_by<>auth.uid() and not public.os_is_admin()) then
    raise exception 'OS_CANDIDATE_DENIED' using errcode='42501';
  end if;
  update public.os_document_candidates set submit_note=left(btrim(coalesce(p_note,'')),300) where id=c.id returning * into c;
  return c;
end $function$;
revoke all on function public.os_candidate_note(uuid,text) from public,anon;
grant execute on function public.os_candidate_note(uuid,text) to authenticated;

-- os_decide_candidate (definition from 20261008180414) + approved_version, and an approved candidate
-- whose document changed since the approval can be decided again.
create or replace function public.os_decide_candidate(p_id uuid,p_expected_version integer,p_decision text,p_note text default '')
returns public.os_documents language plpgsql security definer set search_path='' as $$
declare c public.os_document_candidates; d public.os_documents;
begin
  select * into c from public.os_document_candidates where id=p_id;
  if not found or not (c.status='open' or c.status='approved') then raise exception 'OS_CANDIDATE_NOT_OPEN' using errcode='P0002'; end if;
  select * into d from public.os_documents where id=c.document_id for update;
  select * into c from public.os_document_candidates where id=p_id for update;
  if not (c.status='open' or (c.status='approved' and d.status='reviewed' and c.approved_version is distinct from d.current_version)) then
    raise exception 'OS_CANDIDATE_NOT_OPEN' using errcode='P0002';
  end if;
  if d.current_version is distinct from p_expected_version then raise exception 'OS_VERSION_CONFLICT' using errcode='40001'; end if;
  if not public.os_is_staff() or not public.os_workspace_page_read(d.id)
    or not public.os_can_approve(auth.uid(),d.owner_id) or not public.os_can_approve(auth.uid(),c.submitted_by)
    or (c.requested_approver_id<>auth.uid() and not(public.os_is_admin() and length(btrim(p_note))>0))
    then raise exception 'OS_CANDIDATE_DENIED' using errcode='42501'; end if;
  if p_decision not in ('approved','returned') or (p_decision='returned' and length(btrim(p_note))=0)
    or (c.status='approved' and p_decision<>'approved')   -- a changed approved document is approved again; reviewed → team has no path here
    then raise exception 'OS_DECISION_INVALID' using errcode='22023'; end if;
  d:=public.os_set_document_status(d.id,case when p_decision='approved' then 'reviewed'::public.os_doc_status else 'team'::public.os_doc_status end,p_note);
  update public.os_document_candidates set status=p_decision,decided_by=auth.uid(),decided_at=now(),decision_note=p_note,
    proxy=(requested_approver_id<>auth.uid()),approved_version=case when p_decision='approved' then d.current_version else null end
    where id=c.id;
  insert into public.os_knowledge_events(actor_id,action,target_type,target_id,detail)
    values(auth.uid(),'candidate_'||p_decision,'candidate',c.id,jsonb_build_object('reason',p_note,'version',d.current_version));
  return d;
end $$;

-- os_publish_candidate (definition from 20261018100000) + the approved version must be the current one.
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
  if c.approved_version is not null and c.approved_version is distinct from d.current_version
    then raise exception 'OS_CANDIDATE_CHANGED_SINCE_APPROVAL' using errcode = 'PT409'; end if;
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
    values(u,'candidate_publish','candidate',c.id,jsonb_build_object('approvedBy',c.decided_by,'version',d.current_version));
  return d;
end $function$;
