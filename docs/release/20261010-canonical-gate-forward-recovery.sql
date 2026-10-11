-- Emergency forward recovery for the canonical publisher gate.
-- This is an operator-run script, NOT an active migration. Never run it as
-- part of supabase db push or against Production without release approval.
-- Pause canonical writes and return the app to the pre-gate release first.
-- An approved candidate needs manual handling before this script can run.
-- The script changes functions/trigger grants only; it does not edit rows.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Hold candidate writes while checking pending approvals and changing the gate.
lock table public.os_document_candidates in share row exclusive mode;

do $preflight$
begin
  if to_regprocedure('public.os_decide_candidate(uuid,integer,text,text)') is null
    or to_regprocedure('public.os_publish_candidate(uuid,integer)') is null
    or not exists (
      select 1 from pg_catalog.pg_trigger
      where tgrelid = 'public.os_documents'::regclass
        and tgname = 'os_guard_canonical_publication_trigger'
        and not tgisinternal
    ) then
    raise exception 'CANONICAL_RECOVERY_PREREQUISITE_MISSING';
  end if;

  if exists (
    select 1 from public.os_document_candidates where status = 'approved'
  ) then
    raise exception 'CANONICAL_RECOVERY_PENDING_APPROVALS';
  end if;
end $preflight$;

drop trigger os_guard_canonical_publication_trigger on public.os_documents;

-- Restore the pre-gate decision workflow, keeping the installed PT409
-- conflict response. CREATE OR REPLACE preserves the existing EXECUTE grants.
create or replace function public.os_decide_candidate(
  p_id uuid, p_expected_version integer, p_decision text, p_note text default ''
)
returns public.os_documents language plpgsql security definer set search_path = '' as $$
declare c public.os_document_candidates; d public.os_documents;
begin
  select * into c from public.os_document_candidates where id=p_id;
  if not found or c.status<>'open' then raise exception 'OS_CANDIDATE_NOT_OPEN' using errcode='P0002'; end if;
  select * into d from public.os_documents where id=c.document_id for update;
  select * into c from public.os_document_candidates where id=p_id for update;
  if c.status<>'open' then raise exception 'OS_CANDIDATE_NOT_OPEN' using errcode='P0002'; end if;
  if d.current_version<>p_expected_version then raise exception 'OS_VERSION_CONFLICT' using errcode='PT409'; end if;
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

revoke all on function public.os_publish_candidate(uuid,integer)
  from public, anon, authenticated;
commit;

-- Post-checks (run separately):
-- 1. Trigger absent, os_decide_candidate definition publishes on approval.
-- 2. os_publish_candidate is not executable by anon or authenticated.
-- 3. Existing document/candidate counts and versions match preflight.
