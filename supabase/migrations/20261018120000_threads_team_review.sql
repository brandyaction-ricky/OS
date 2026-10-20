-- Threads team review inbox (2026-10-18 handoff: "내 초안 / 팀 검수함").
-- Additive. Personal drafts stay private; only a Threads draft its owner shares
-- (metadata.shared = 'team') becomes readable by every active member. The row keeps
-- its id, owner, version and history. Editing and approving a shared draft is
-- limited to the named Threads reviewers; the owner keeps editing their own draft.
begin;

-- Named reviewers (initially the Threads operator and the co-reviewer). Managed by
-- admins through the app; ids are data, not part of this migration.
create table public.os_content_reviewers (
  user_id uuid primary key references public.os_profiles(id),
  created_by uuid not null references public.os_profiles(id),
  created_at timestamptz not null default now()
);
alter table public.os_content_reviewers enable row level security;
revoke all on public.os_content_reviewers from public,anon,authenticated;
grant all on public.os_content_reviewers to service_role;

create function public.os_is_content_reviewer(p_actor uuid) returns boolean
language sql stable security definer set search_path to '' as $$
  select exists(select 1 from public.os_content_reviewers r
    join public.os_profiles p on p.id=r.user_id where r.user_id=p_actor and p.is_active)
$$;
revoke all on function public.os_is_content_reviewer(uuid) from public,anon,authenticated;
grant execute on function public.os_is_content_reviewer(uuid) to service_role;

-- Review notes on a shared draft. Append-only, written by the server only.
create table public.os_content_review_comments (
  id uuid primary key default gen_random_uuid(),
  publish_record_id uuid not null references public.os_records(id),
  author_id uuid not null references public.os_profiles(id),
  content_version integer not null check(content_version>0),
  body text not null check(length(btrim(body)) between 1 and 3000),
  created_at timestamptz not null default now()
);
create index os_content_review_comments_record_idx on public.os_content_review_comments(publish_record_id,created_at);
create trigger os_content_review_comments_immutable before update or delete on public.os_content_review_comments
for each row execute function public.os_content_append_only();
alter table public.os_content_review_comments enable row level security;
revoke all on public.os_content_review_comments from public,anon,authenticated;
grant all on public.os_content_review_comments to service_role;

-- Reads: a shared Threads draft is readable by active members. Writes keep the
-- original owner-only rule (the same predicate the FOR ALL policy had).
drop policy os_records_personal_space on public.os_records;
create policy os_records_personal_space_read on public.os_records as restrictive
for select to authenticated
using (coalesce(metadata->>'space','') <> 'personal' or owner_id = (select auth.uid())
  or (record_type='content_publish' and metadata->>'shared'='team' and (select public.os_is_active_member())));
create policy os_records_personal_space_insert on public.os_records as restrictive
for insert to authenticated
with check (coalesce(metadata->>'space','') <> 'personal' or owner_id = (select auth.uid()));
create policy os_records_personal_space_update on public.os_records as restrictive
for update to authenticated
using (coalesce(metadata->>'space','') <> 'personal' or owner_id = (select auth.uid()))
with check (coalesce(metadata->>'space','') <> 'personal' or owner_id = (select auth.uid()));
create policy os_records_personal_space_delete on public.os_records as restrictive
for delete to authenticated
using (coalesce(metadata->>'space','') <> 'personal' or owner_id = (select auth.uid()));

-- History: os_record_events snapshots of personal records were readable by every
-- active member (this gate returned true for them). Apply the same rule as the row.
create or replace function public.os_workspace_record_read(p_record uuid)
 returns boolean
 language sql stable security definer set search_path to ''
as $function$
  select coalesce((select case
    when r.record_type='meeting' and r.metadata->>'workspace'='knowledge' then public.os_can_read_meeting_record(r.id)
    when r.record_type in ('decision','task') and exists(select 1 from public.os_records p where p.id=r.parent_id and p.record_type='meeting' and p.metadata->>'workspace'='knowledge') then public.os_can_read_meeting_record(r.parent_id)
    when r.metadata->>'space'='personal' then r.owner_id=auth.uid()
      or (r.record_type='content_publish' and r.metadata->>'shared'='team' and public.os_is_active_member())
    else true end from public.os_records r where r.id=p_record),false)
$function$;

-- Same create request (UI retry, slow response, or an automation run re-sending a
-- candidate) returns the existing topic instead of a duplicate.
create unique index os_content_personal_topic_request_idx on public.os_records(owner_id,(metadata->>'requestId'))
where record_type='content_topic' and metadata->>'space'='personal'
  and metadata->>'requestId' is not null and archived_at is null;

-- Review command: unchanged except it now records the human reviewer (p_actor) and,
-- for a shared draft, requires a named reviewer. p_actor defaults to the owner, so
-- the previous six-argument calls keep working.
drop function public.os_content_review_command(uuid,uuid,integer,text,jsonb,text);
create function public.os_content_review_command(
  p_owner uuid,p_record uuid,p_expected_version integer,p_result text,
  p_checks jsonb,p_note text default null,p_actor uuid default null
) returns public.os_records
language plpgsql security invoker set search_path=public,pg_temp as $$
declare source public.os_records; saved public.os_records; unknown_count integer:=0; direct_count integer:=0;
  reviewer uuid:=coalesce(p_actor,p_owner);
begin
  select * into source from public.os_records
  where id=p_record and owner_id=p_owner and record_type='content_publish'
    and metadata->>'space'='personal' and archived_at is null for update;
  if not found or (reviewer<>p_owner and coalesce(source.metadata->>'shared','')<>'team')
    then raise exception using errcode='PT404',message='CONTENT_NOT_FOUND'; end if;
  if source.metadata->>'shared'='team' and not public.os_is_content_reviewer(reviewer)
    then raise exception using errcode='PT403',message='TEAM_REVIEWER_REQUIRED'; end if;
  if source.version<>p_expected_version then raise exception using errcode='PT409',message='CONTENT_VERSION_CHANGED'; end if;
  if p_result is null or p_result not in ('ready','changes') or jsonb_typeof(p_checks) is distinct from 'array'
    then raise exception using errcode='PT422',message='REVIEW_INVALID'; end if;
  if p_result='ready' and source.status<>'review'
    then raise exception using errcode='PT409',message='REVIEW_STATUS_CHANGED'; end if;
  if p_result='changes' and source.status not in ('review','ready')
    then raise exception using errcode='PT409',message='REVIEW_STATUS_CHANGED'; end if;
  select count(distinct check_item->>'key') into direct_count
  from jsonb_array_elements(p_checks) check_item
  where check_item->>'key' in ('numbers','message','ending','forbidden','ads')
    and check_item->>'by'='me' and check_item->>'ok'='true';
  select count(*) into unknown_count
  from jsonb_array_elements(case when jsonb_typeof(source.metadata->'pages')='array'
       then source.metadata->'pages' else '[]'::jsonb end) page,
       lateral jsonb_each(case when jsonb_typeof(page->'slots')='object'
       then page->'slots' else '{}'::jsonb end) slot
  where jsonb_typeof(slot.value)='object' and slot.value ? 'ref'
    and not exists (select 1 from public.os_records asset
      where asset.id=case when slot.value->>'ref' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (slot.value->>'ref')::uuid else null end
        and asset.owner_id=p_owner and asset.record_type='content_asset'
        and asset.metadata->>'space'='personal' and asset.archived_at is null
        and asset.metadata->'license'->>'source' in ('own','designer','stock')
        and (asset.metadata->'license'->>'source'<>'stock' or
          (coalesce(asset.metadata->'license'->>'licenseNo','')<>''
            and coalesce(asset.metadata->'license'->>'vendor','')<>''
            and coalesce(asset.metadata->'license'->>'purchasedAt','')<>''))
        and (coalesce(asset.metadata->'consent'->>'person','false')<>'true' or
          coalesce(asset.metadata->'consent'->>'expiresAt','')>=current_date::text));
  unknown_count:=greatest(unknown_count,case when
    coalesce(source.metadata->'licenseSummary'->>'unknown','') ~ '^[0-9]{1,6}$'
    then (source.metadata->'licenseSummary'->>'unknown')::integer else 0 end);
  if p_result='ready' and source.metadata->>'channel'='shorts'
    and (coalesce(source.metadata->>'mp4Path','')='' or
      coalesce(source.metadata->>'mp4Source','')='' or
      coalesce(source.metadata->>'coverPath','')='' or
      coalesce(source.metadata->>'bgmSource','')='' or
      not exists (select 1 from public.os_records cover
        where cover.id=case when source.metadata->>'coverAssetId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (source.metadata->>'coverAssetId')::uuid else null end
          and cover.owner_id=p_owner and cover.record_type='content_asset'
          and cover.metadata->>'space'='personal' and cover.archived_at is null
          and cover.metadata->>'storagePath'=source.metadata->>'coverPath'
          and cover.metadata->'license'->>'source' in ('own','designer','stock')
          and (cover.metadata->'license'->>'source'<>'stock' or
            (coalesce(cover.metadata->'license'->>'licenseNo','')<>''
              and coalesce(cover.metadata->'license'->>'vendor','')<>''
              and coalesce(cover.metadata->'license'->>'purchasedAt','')<>''))
          and (coalesce(cover.metadata->'consent'->>'person','false')<>'true' or
            coalesce(cover.metadata->'consent'->>'expiresAt','')>=current_date::text)))
    then raise exception using errcode='PT422',message='SHORTS_MEDIA_SOURCE_REQUIRED'; end if;
  if p_result='ready' and (direct_count<>5 or unknown_count>0)
    then raise exception using errcode='PT422',message='REVIEW_CHECKS_REQUIRED'; end if;
  if p_result='changes' and length(trim(coalesce(p_note,'')))=0
    then raise exception using errcode='PT422',message='REVIEW_NOTE_REQUIRED'; end if;
  update public.os_records set
    status=case when p_result='ready' then 'ready' else 'blocked' end,
    stage=case when p_result='ready' then 'approved' else 'changes' end,
    metadata=case when p_result='ready' then source.metadata
      else jsonb_set(source.metadata,'{changeNote}',to_jsonb(p_note)) end,
    updated_by=reviewer
  where id=p_record and owner_id=p_owner and version=p_expected_version
  returning * into saved;
  if not found then raise exception using errcode='PT409',message='CONTENT_VERSION_CHANGED'; end if;
  insert into public.os_content_review_log(
    owner_id,publish_record_id,content_version,result,checks,
    license_unknown,overflow_slots,note,created_by
  ) values(
    p_owner,p_record,p_expected_version,p_result,p_checks,unknown_count,
    case when coalesce(source.metadata->>'overflowSlots','') ~ '^[0-9]{1,6}$'
      then (source.metadata->>'overflowSlots')::integer else 0 end,p_note,reviewer
  );
  return saved;
end $$;
revoke all on function public.os_content_review_command(uuid,uuid,integer,text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.os_content_review_command(uuid,uuid,integer,text,jsonb,text,uuid) to service_role;

commit;
