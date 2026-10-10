-- A single active account may perform the final publication after an independent review.
-- No account is assigned by this migration; an administrator selects the account in Members.
alter table public.os_profiles
  add column if not exists canonical_publisher boolean not null default false;
create unique index if not exists os_profiles_one_canonical_publisher
  on public.os_profiles (canonical_publisher) where canonical_publisher;

create function public.os_guard_canonical_publication() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'canonical' and old.status is distinct from 'canonical' then
    if current_setting('os.canonical_publish_ok', true) is distinct from '1'
      or not exists (
        select 1 from public.os_profiles p
        where p.id = auth.uid() and p.is_active and p.member_kind = 'staff'
          and p.role = 'admin' and p.canonical_publisher
      ) then
      raise exception 'OS_CANONICAL_PUBLISHER_REQUIRED' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger os_guard_canonical_publication_trigger
  before update of status on public.os_documents
  for each row execute function public.os_guard_canonical_publication();
revoke all on function public.os_guard_canonical_publication() from public, anon, authenticated;

-- Approval records the independent decision but does not publish the document.
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
  if not public.os_is_staff() or not public.os_workspace_page_read(d.id)
    or not public.os_can_approve(auth.uid(),d.owner_id) or not public.os_can_approve(auth.uid(),c.submitted_by)
    or (c.requested_approver_id<>auth.uid() and not(public.os_is_admin() and length(btrim(p_note))>0))
    then raise exception 'OS_CANDIDATE_DENIED' using errcode='42501'; end if;
  if p_decision not in ('approved','returned') or (p_decision='returned' and length(btrim(p_note))=0)
    then raise exception 'OS_DECISION_INVALID' using errcode='22023'; end if;
  d:=public.os_set_document_status(d.id,case when p_decision='approved' then 'reviewed'::public.os_doc_status else 'team'::public.os_doc_status end,p_note);
  update public.os_document_candidates set status=p_decision,decided_by=auth.uid(),decided_at=now(),decision_note=p_note,proxy=(requested_approver_id<>auth.uid()) where id=c.id;
  insert into public.os_knowledge_events(actor_id,action,target_type,target_id,detail)
    values(auth.uid(),'candidate_'||p_decision,'candidate',c.id,jsonb_build_object('reason',p_note));
  return d;
end $$;

create function public.os_publish_candidate(p_id uuid,p_expected_version integer)
returns public.os_documents language plpgsql security definer set search_path='' as $$
declare c public.os_document_candidates; d public.os_documents; u uuid:=auth.uid();
begin
  select * into c from public.os_document_candidates where id=p_id;
  if not found or c.status<>'approved' then raise exception 'OS_CANDIDATE_NOT_APPROVED' using errcode='42501'; end if;
  select * into d from public.os_documents where id=c.document_id for update;
  select * into c from public.os_document_candidates where id=p_id for update;
  if not found or c.status<>'approved' or d.status<>'reviewed' or d.current_version<>p_expected_version
    then raise exception 'OS_CANDIDATE_CHANGED' using errcode='40001'; end if;
  if not public.os_workspace_page_read(d.id) or not exists (
    select 1 from public.os_profiles p where p.id=u and p.is_active
      and p.member_kind='staff' and p.role='admin' and p.canonical_publisher
  ) then raise exception 'OS_CANONICAL_PUBLISHER_REQUIRED' using errcode='42501'; end if;
  if c.decided_by is null or c.decided_by=u or c.decided_by=d.owner_id or c.decided_by=c.submitted_by
    then raise exception 'OS_INDEPENDENT_APPROVAL_REQUIRED' using errcode='42501'; end if;
  perform pg_catalog.set_config('os.status_change_ok','1',true);
  perform pg_catalog.set_config('os.canonical_publish_ok','1',true);
  update public.os_documents set status='canonical',folder=c.target_folder,steward_id=c.steward_id,
    review_due_on=c.review_due_on,retention_hold=true,category_id=null
    where id=d.id returning * into d;
  perform pg_catalog.set_config('os.canonical_publish_ok','',true);
  perform pg_catalog.set_config('os.status_change_ok','',true);
  insert into public.os_document_events(document_id,from_status,to_status,actor_id,note)
    values(d.id,'reviewed','canonical',u,'독립 검토 후 최종 등록');
  insert into public.os_knowledge_events(actor_id,action,target_type,target_id,detail)
    values(u,'candidate_publish','candidate',c.id,jsonb_build_object('approvedBy',c.decided_by));
  return d;
end $$;
revoke all on function public.os_publish_candidate(uuid,integer) from public,anon;
grant execute on function public.os_publish_candidate(uuid,integer) to authenticated;
