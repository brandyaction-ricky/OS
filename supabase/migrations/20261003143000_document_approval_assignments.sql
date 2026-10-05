-- F1: separate document authors from approvers without changing existing rows.
create table if not exists public.os_approval_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.os_profiles(id),
  kind text not null check (kind in ('approver', 'delegate')),
  delegated_by uuid references public.os_profiles(id),
  starts_on date,
  ends_on date,
  created_by uuid not null references public.os_profiles(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint os_approval_assignment_shape check (
    (kind = 'approver' and delegated_by is null)
    or (kind = 'delegate' and delegated_by is not null and delegated_by <> user_id
        and starts_on is not null and ends_on is not null)
  ),
  constraint os_approval_assignment_period check (starts_on is null or ends_on is null or starts_on <= ends_on)
);

create unique index if not exists os_approval_active_approver_user
  on public.os_approval_assignments(user_id)
  where kind = 'approver' and revoked_at is null;
create index if not exists os_approval_active_delegate
  on public.os_approval_assignments(user_id, starts_on, ends_on)
  where kind = 'delegate' and revoked_at is null;

alter table public.os_approval_assignments enable row level security;
revoke all on public.os_approval_assignments from public, anon, authenticated;
grant select, insert, update on public.os_approval_assignments to service_role;

create or replace function public.os_can_approve(p_actor uuid, p_author uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    p_actor is not null
    and p_actor is distinct from p_author
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
$$;

revoke all on function public.os_can_approve(uuid, uuid) from public, anon;
grant execute on function public.os_can_approve(uuid, uuid) to authenticated, service_role;

create or replace function public.os_set_document_status(p_document_id uuid, p_to public.os_doc_status, p_note text default '')
returns public.os_documents
language plpgsql security definer
set search_path = ''
as $$
declare
  d public.os_documents;
  v_from public.os_doc_status;
  v_uid uuid := auth.uid();
  v_owner boolean;
  v_active boolean;
  v_admin boolean := coalesce(public.os_is_admin(), false);
  v_delegator text;
  v_note text := coalesce(p_note, '');
  ok boolean := false;
begin
  select * into d from public.os_documents where id = p_document_id for update;
  if not found then raise exception 'OS_DOC_NOT_FOUND' using errcode = 'P0002'; end if;

  select exists(select 1 from public.os_profiles p where p.id = v_uid and p.is_active) into v_active;
  v_from := d.status;
  v_owner := d.owner_id = v_uid;
  if v_from = p_to then return d; end if;

  ok := case
    when v_from = 'draft' and p_to = 'team' then v_owner or v_admin
    when v_from in ('draft', 'team', 'review', 'reviewed') and p_to = 'canonical'
      then public.os_can_approve(v_uid, d.owner_id)
    when v_from = 'team' and p_to = 'review' then (v_owner and v_active) or v_admin
    when v_from = 'review' and p_to = 'team' then v_active or v_admin
    when v_from = 'review' and p_to = 'reviewed' then public.os_can_approve(v_uid, d.owner_id)
    when v_from = 'reviewed' and p_to = 'review' then v_active or v_admin
    when v_from = 'canonical' and p_to = 'review' then v_active or v_admin
    when p_to = 'archived' then v_admin or (v_owner and v_from <> 'canonical')
    when p_to = 'draft' and v_from in ('team', 'review', 'reviewed') then v_owner or v_admin
    when v_from = 'archived' and p_to in ('draft', 'team') then v_owner or v_admin
    else false
  end;
  if not ok then
    raise exception 'OS_STATUS_TRANSITION_DENIED: % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  if (p_to = 'canonical' or (v_from = 'review' and p_to = 'reviewed')) then
    select delegator.display_name into v_delegator
    from public.os_approval_assignments delegation
    join public.os_profiles delegator on delegator.id = delegation.delegated_by
    where delegation.kind = 'delegate' and delegation.user_id = v_uid
      and delegation.revoked_at is null and current_date between delegation.starts_on and delegation.ends_on
      and not exists (
        select 1 from public.os_approval_assignments direct
        where direct.kind = 'approver' and direct.user_id = v_uid and direct.revoked_at is null
          and (direct.starts_on is null or direct.starts_on <= current_date)
          and (direct.ends_on is null or direct.ends_on >= current_date)
      )
    order by delegation.created_at desc limit 1;
    if v_delegator is not null then
      v_note := concat_ws(' · ', nullif(v_note, ''), '위임 승인 · 맡긴 사람: ' || v_delegator);
    end if;
  end if;

  perform pg_catalog.set_config('os.status_change_ok', '1', true);
  update public.os_documents set status = p_to where id = p_document_id returning * into d;
  perform pg_catalog.set_config('os.status_change_ok', '', true);
  insert into public.os_document_events (document_id, from_status, to_status, actor_id, note)
  values (p_document_id, v_from, p_to, v_uid, v_note);
  return d;
end;
$$;

revoke all on function public.os_set_document_status(uuid, public.os_doc_status, text) from public, anon;
grant execute on function public.os_set_document_status(uuid, public.os_doc_status, text) to authenticated, service_role;

-- Candidate decisions must never be changed through the generic records path.
create or replace function public.os_guard_appeal_decisions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.record_type = 'content_package' and new.metadata->>'packageKind' = 'appeal_candidates'
      and (
        exists (
          select 1 from jsonb_array_elements(coalesce(new.metadata #> '{result,candidates}', '[]'::jsonb)) as items(item)
          where coalesce(items.item->>'decision', 'pending') <> 'pending' or items.item ? 'decidedAt'
        )
        or jsonb_array_length(coalesce(new.metadata->'decisionHistory', '[]'::jsonb)) > 0
        or coalesce(new.metadata->>'workflowStage', '대표 승인 대기') <> '대표 승인 대기'
      ) then
      raise exception 'OS_APPEAL_DECISION_API_REQUIRED' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.record_type = 'content_package' and new.metadata->>'packageKind' = 'appeal_candidates'
    and (old.record_type <> 'content_package' or old.metadata->>'packageKind' is distinct from 'appeal_candidates') then
    raise exception 'OS_APPEAL_PACKAGE_IMMUTABLE' using errcode = '42501';
  end if;
  if old.record_type = 'content_package' and old.metadata->>'packageKind' = 'appeal_candidates'
    and (
      old.record_type is distinct from new.record_type
      or old.metadata->>'packageKind' is distinct from new.metadata->>'packageKind'
      or
      old.metadata #> '{result,candidates}' is distinct from new.metadata #> '{result,candidates}'
      or old.metadata->'decisionHistory' is distinct from new.metadata->'decisionHistory'
      or old.metadata->'workflowStage' is distinct from new.metadata->'workflowStage'
    )
    and current_setting('os.appeal_decision_ok', true) is distinct from '1' then
    raise exception 'OS_APPEAL_DECISION_API_REQUIRED' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger os_guard_appeal_decisions_trigger before insert or update on public.os_records
for each row execute function public.os_guard_appeal_decisions();
revoke all on function public.os_guard_appeal_decisions() from public, anon, authenticated;

create or replace function public.os_decide_appeals(
  p_record_id uuid, p_expected_version integer, p_set_version text, p_entries jsonb
)
returns public.os_records
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.os_records;
  v_actor uuid := auth.uid();
  v_candidates jsonb;
  v_history jsonb;
  v_entry jsonb;
  v_candidate jsonb;
  v_index integer;
  v_decision text;
  v_note text;
  v_seen integer[] := '{}'::integer[];
  v_approved integer := 0;
  v_updated boolean := false;
begin
  select * into r from public.os_records where id = p_record_id and archived_at is null for update;
  if not found or r.record_type <> 'content_package' or r.metadata->>'packageKind' <> 'appeal_candidates' then
    raise exception 'OS_APPEAL_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.os_can_approve(v_actor, r.created_by) then
    raise exception 'OS_APPEAL_APPROVAL_DENIED' using errcode = '42501';
  end if;
  if r.version <> p_expected_version or (r.metadata ? 'candidateSetVersion'
    and r.metadata->>'candidateSetVersion' is distinct from p_set_version) then
    raise exception 'OS_APPEAL_VERSION_CONFLICT' using errcode = '40001';
  end if;
  v_candidates := r.metadata #> '{result,candidates}';
  if jsonb_typeof(v_candidates) <> 'array' or jsonb_typeof(p_entries) <> 'array'
    or jsonb_array_length(p_entries) < 1 or jsonb_array_length(p_entries) > 12 then
    raise exception 'OS_APPEAL_ENTRIES_INVALID' using errcode = '22023';
  end if;
  v_history := coalesce(r.metadata->'decisionHistory', '[]'::jsonb);
  if jsonb_typeof(v_history) <> 'array' then v_history := '[]'::jsonb; end if;
  for v_entry in select value from jsonb_array_elements(p_entries) loop
    if jsonb_typeof(v_entry->'index') <> 'number' or (v_entry->>'index') !~ '^[0-9]+$' then
      raise exception 'OS_APPEAL_INDEX_INVALID' using errcode = '22023';
    end if;
    v_index := (v_entry->>'index')::integer;
    v_decision := v_entry->>'decision';
    v_note := left(coalesce(v_entry->>'note', ''), 500);
    if v_index >= jsonb_array_length(v_candidates) or v_index = any(v_seen)
      or v_decision not in ('approved', 'revision', 'held') then
      raise exception 'OS_APPEAL_ENTRY_INVALID' using errcode = '22023';
    end if;
    if v_decision = 'revision' and btrim(v_note) = '' then
      raise exception 'OS_APPEAL_REASON_REQUIRED' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_index);
    v_candidate := v_candidates->v_index;
    v_candidate := jsonb_set(v_candidate, '{decision}', to_jsonb(v_decision), true);
    v_candidate := jsonb_set(v_candidate, '{decidedAt}', to_jsonb(now()::text), true);
    v_candidates := jsonb_set(v_candidates, array[v_index::text], v_candidate);
    v_history := v_history || jsonb_build_object(
      'candidateIndex', v_index, 'text', v_candidate->>'text', 'decision', v_decision,
      'decidedAt', now(), 'actorId', v_actor, 'note', v_note
    );
  end loop;
  while jsonb_array_length(v_history) > 100 loop v_history := v_history - 0; end loop;
  select count(*) into v_approved from jsonb_array_elements(v_candidates) as items(item)
  where items.item->>'decision' = 'approved';

  perform pg_catalog.set_config('os.appeal_decision_ok', '1', true);
  update public.os_records
  set metadata = jsonb_set(
        jsonb_set(
          jsonb_set(r.metadata, '{result,candidates}', v_candidates),
          '{decisionHistory}', v_history
        ), '{workflowStage}', to_jsonb(case when v_approved > 0 then '레퍼런스 검증 대기' else '대표 승인 대기' end::text)
      ), updated_by = v_actor
  where id = p_record_id and version = p_expected_version
  returning * into r;
  v_updated := found;
  perform pg_catalog.set_config('os.appeal_decision_ok', '', true);
  if not v_updated then raise exception 'OS_APPEAL_VERSION_CONFLICT' using errcode = '40001'; end if;
  return r;
end;
$$;

revoke all on function public.os_decide_appeals(uuid, integer, text, jsonb) from public, anon;
grant execute on function public.os_decide_appeals(uuid, integer, text, jsonb) to authenticated;
