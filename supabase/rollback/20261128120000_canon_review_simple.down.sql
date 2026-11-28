-- Rollback of 20261128120000_canon_review_simple: the decide/publish functions return to their earlier definitions
-- (20261008180414 · 20261018100000), the note function goes, and the two columns are dropped (their values are lost).
begin;
create or replace function public.os_decide_candidate(p_id uuid,p_expected_version integer,p_decision text,p_note text default '')
returns public.os_documents language plpgsql security definer set search_path='' as $$
declare c public.os_document_candidates; d public.os_documents;
begin
  select * into c from public.os_document_candidates where id=p_id;
  if not found or c.status<>'open' then raise exception 'OS_CANDIDATE_NOT_OPEN' using errcode='P0002'; end if;
  select * into d from public.os_documents where id=c.document_id for update;
  select * into c from public.os_document_candidates where id=p_id for update;
  if c.status<>'open' then raise exception 'OS_CANDIDATE_NOT_OPEN' using errcode='P0002'; end if;
  if d.current_version<>p_expected_version then raise exception 'OS_VERSION_CONFLICT' using errcode='40001'; end if;
  if not public.os_is_staff() or not public.os_workspace_page_read(d.id) or not public.os_can_approve(auth.uid(),d.owner_id) or not public.os_can_approve(auth.uid(),c.submitted_by)
    or (c.requested_approver_id<>auth.uid() and not(public.os_is_admin() and length(btrim(p_note))>0)) then raise exception 'OS_CANDIDATE_DENIED' using errcode='42501'; end if;
  if p_decision not in ('approved','returned') or (p_decision='returned' and length(btrim(p_note))=0) then raise exception 'OS_DECISION_INVALID' using errcode='22023'; end if;
  if p_decision='approved' then
    perform pg_catalog.set_config('os.candidate_decide_ok','1',true);
    perform pg_catalog.set_config('os.proposal_apply_ok','1',true);
    update public.os_documents set folder=c.target_folder,steward_id=c.steward_id,review_due_on=c.review_due_on where id=d.id;
    d:=public.os_set_document_status(d.id,'canonical',p_note);
    perform pg_catalog.set_config('os.proposal_apply_ok','',true);
    perform pg_catalog.set_config('os.candidate_decide_ok','',true);
  else d:=public.os_set_document_status(d.id,'team',p_note); end if;
  update public.os_document_candidates set status=p_decision,decided_by=auth.uid(),decided_at=now(),decision_note=p_note,proxy=(requested_approver_id<>auth.uid()) where id=c.id;
  insert into public.os_knowledge_events(actor_id,action,target_type,target_id,detail) values(auth.uid(),'candidate_'||p_decision,'candidate',c.id,jsonb_build_object('reason',p_note));
  return d;
end $$;

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

drop function if exists public.os_candidate_note(uuid,text);
alter table public.os_document_candidates drop constraint if exists os_document_candidates_submit_note_len;
alter table public.os_document_candidates drop column if exists approved_version, drop column if exists submit_note;
delete from supabase_migrations.schema_migrations where version = '20261128120000';
commit;
