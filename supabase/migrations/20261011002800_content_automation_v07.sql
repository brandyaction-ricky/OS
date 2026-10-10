-- Content automation v0.7. Additive schema only; no existing record data is moved.
begin;

alter table public.os_records drop constraint if exists os_records_record_type_check;
alter table public.os_records add constraint os_records_record_type_check check (record_type in (
  'project','task','goal','kpi','decision','meeting','ai_job',
  'development_log','deployment','development_comment','development_notification','notification',
  'content_topic','content_script','content_package','content_short','content_publish','content_metric','content_comment','content_asset',
  'skill','knowledge_link','revenue','funnel','crm_action','customer','brand','connection','access_rule',
  'company_setting','channel','leave_balance','leave_request','expense','contract','subscription','company_document'
));

-- Existing permissive policies remain intact for shared records. A restrictive
-- policy narrows every authenticated operation on explicitly personal records.
create policy os_records_personal_space on public.os_records as restrictive
for all to authenticated
using (coalesce(metadata->>'space','') <> 'personal' or owner_id = (select auth.uid()))
with check (coalesce(metadata->>'space','') <> 'personal' or owner_id = (select auth.uid()));
create policy os_personal_content_insert_gate on public.os_records as restrictive
for insert to authenticated with check (
  record_type<>'content_publish' or coalesce(metadata->>'space','')<>'personal' or status='draft'
);
create policy os_personal_content_update_gate on public.os_records as restrictive
for update to authenticated
using (record_type<>'content_publish' or coalesce(metadata->>'space','')<>'personal'
  or status in ('draft','blocked','review'))
with check (record_type<>'content_publish' or coalesce(metadata->>'space','')<>'personal'
  or status in ('draft','blocked','review'));
create index os_records_personal_owner_type_idx on public.os_records(owner_id,record_type,created_at desc)
where archived_at is null and metadata->>'space'='personal';
create unique index os_ai_job_open_unique_idx on public.os_records(
  owner_id,(metadata->>'proc'),(coalesce(metadata->>'targetId','')),(coalesce(metadata->>'sub',''))
) where record_type='ai_job' and metadata->>'space'='personal'
  and status in ('backlog','active') and archived_at is null;
create unique index os_content_personal_topic_channel_idx on public.os_records(owner_id,parent_id,(metadata->>'channel'))
where record_type='content_publish' and metadata->>'space'='personal' and archived_at is null;
create unique index os_content_personal_comment_topic_idx on public.os_records(owner_id,(metadata->>'sourceRef'))
where record_type='content_topic' and metadata->>'space'='personal'
  and metadata->>'source'='comment' and archived_at is null;
create unique index os_content_personal_active_skill_idx on public.os_records(owner_id,(metadata->>'process'))
where record_type='skill' and metadata->>'space'='personal'
  and metadata->>'active'='true' and archived_at is null;
create sequence public.os_ai_job_no_seq;
create function public.os_assign_ai_job_number() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.record_type='ai_job' and new.metadata->>'space'='personal'
    and not (new.metadata ? 'jobNo') then
    new.metadata=jsonb_set(new.metadata,'{jobNo}',to_jsonb(nextval('public.os_ai_job_no_seq')));
  end if;
  return new;
end $$;
create trigger os_assign_ai_job_number before insert on public.os_records
for each row execute function public.os_assign_ai_job_number();
revoke all on function public.os_assign_ai_job_number() from public,anon,authenticated;

create table public.os_ai_browsers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.os_profiles(id),
  name text not null check(length(trim(name)) between 1 and 120),
  os text,
  key_hash text not null unique check(key_hash ~ '^[0-9a-f]{64}$'),
  is_main boolean not null default false,
  registered_at timestamptz not null default now(),
  last_run_at timestamptz,
  login_expired_at timestamptz,
  removed_at timestamptz,
  cleanup jsonb
);
create unique index os_ai_browsers_main_idx on public.os_ai_browsers(owner_id) where is_main and removed_at is null;
create index os_ai_browsers_owner_idx on public.os_ai_browsers(owner_id,registered_at desc);

create table public.os_ai_run_rules (
  owner_id uuid primary key references public.os_profiles(id),
  enabled boolean not null default true,
  days text not null default 'daily' check(days in ('daily','weekdays','monday')),
  times text[] not null default array['09:00','13:00','17:00']::text[]
    check(cardinality(times) between 1 and 6 and array_position(times,null) is null),
  per_run integer not null default 3 check(per_run in (1,3,5)),
  daily_max integer not null default 15 check(daily_max in (10,15,30)),
  order_by text not null default 'due' check(order_by in ('due','made','proc')),
  long_only_now boolean not null default true,
  grace_minutes integer not null default 15 check(grace_minutes in (15,30,60)),
  lease_minutes integer not null default 120 check(lease_minutes between 15 and 240),
  notify boolean not null default true,
  defaults jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.os_ai_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.os_profiles(id),
  via text not null check(via in ('sched','now')),
  slot text check(slot is null or slot ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  browser_id uuid not null references public.os_ai_browsers(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'running' check(status in ('running','done','empty','abandoned')),
  job_ids uuid[] not null default '{}',
  done_count integer not null default 0 check(done_count>=0),
  blocked_count integer not null default 0 check(blocked_count>=0)
);
create index os_ai_runs_owner_started_idx on public.os_ai_runs(owner_id,started_at desc);

create table public.os_publication_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.os_profiles(id),
  publish_record_id uuid not null references public.os_records(id),
  platform text not null check(platform in ('instagram','threads','youtube')),
  event text not null check(event in ('published','failed','url_recorded','marked_deleted','metric_collected')),
  method text check(method is null or method in ('os','manual')),
  posted_by uuid references public.os_profiles(id),
  at timestamptz not null default now(),
  content_version integer,
  account_handle text,
  external_account_id text,
  format text,
  permalink text,
  external_id text,
  error jsonb,
  metric_point text check(metric_point is null or metric_point in ('d1','d7','d28')),
  created_at timestamptz not null default now()
);
create index os_publication_events_owner_idx on public.os_publication_events(owner_id,at desc);
create index os_publication_events_record_idx on public.os_publication_events(publish_record_id,platform,created_at desc);

create table public.os_content_review_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.os_profiles(id),
  publish_record_id uuid not null references public.os_records(id),
  content_version integer not null check(content_version>0),
  result text not null check(result in ('ready','changes')),
  checks jsonb not null default '[]'::jsonb,
  license_unknown integer not null default 0 check(license_unknown>=0),
  overflow_slots integer not null default 0 check(overflow_slots>=0),
  note text,
  created_by uuid not null references public.os_profiles(id),
  created_at timestamptz not null default now()
);
create index os_content_review_log_record_idx on public.os_content_review_log(publish_record_id,created_at desc);

create function public.os_content_append_only() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  raise exception using errcode='23514', message='CONTENT_HISTORY_APPEND_ONLY';
end $$;
create trigger os_publication_events_immutable before update or delete on public.os_publication_events
for each row execute function public.os_content_append_only();
create trigger os_content_review_log_immutable before update or delete on public.os_content_review_log
for each row execute function public.os_content_append_only();

alter table public.os_ai_browsers enable row level security;
alter table public.os_ai_run_rules enable row level security;
alter table public.os_ai_runs enable row level security;
alter table public.os_publication_events enable row level security;
alter table public.os_content_review_log enable row level security;

create policy os_ai_browsers_owner_read on public.os_ai_browsers for select to authenticated
using ((select public.os_is_active_member()) and owner_id=(select auth.uid()));
create policy os_ai_run_rules_owner_read on public.os_ai_run_rules for select to authenticated
using ((select public.os_is_active_member()) and owner_id=(select auth.uid()));
create policy os_ai_runs_owner_read on public.os_ai_runs for select to authenticated
using ((select public.os_is_active_member()) and owner_id=(select auth.uid()));
create policy os_publication_events_owner_read on public.os_publication_events for select to authenticated
using ((select public.os_is_active_member()) and owner_id=(select auth.uid()));
create policy os_content_review_log_owner_read on public.os_content_review_log for select to authenticated
using ((select public.os_is_active_member()) and owner_id=(select auth.uid()));

revoke all on public.os_ai_browsers,public.os_ai_run_rules,public.os_ai_runs,public.os_publication_events,public.os_content_review_log from public,anon,authenticated;
grant select on public.os_ai_browsers,public.os_ai_run_rules,public.os_ai_runs,public.os_publication_events,public.os_content_review_log to authenticated;
grant all on public.os_ai_browsers,public.os_ai_run_rules,public.os_ai_runs,public.os_publication_events,public.os_content_review_log to service_role;

create view public.os_publication_log_v with (security_invoker=true) as
select distinct on (e.publish_record_id,e.platform)
  e.publish_record_id,e.platform,e.owner_id,e.id as latest_event_id,
  coalesce((select first_post.at from public.os_publication_events first_post
    where first_post.publish_record_id=e.publish_record_id and first_post.platform=e.platform
      and first_post.event='published' and first_post.created_at<=e.created_at
    order by first_post.created_at desc,first_post.id desc limit 1),e.at) as at,
  case when e.event='marked_deleted' then 'deleted'
       when e.event='failed' then 'failed'
       when not exists(select 1 from public.os_publication_events link
         where link.publish_record_id=e.publish_record_id and link.platform=e.platform
           and link.permalink is not null and link.created_at<=e.created_at) then 'nourl'
       else 'published' end as status,
  coalesce(e.method,(select first_post.method from public.os_publication_events first_post
    where first_post.publish_record_id=e.publish_record_id and first_post.platform=e.platform
      and first_post.event='published' and first_post.created_at<=e.created_at
    order by first_post.created_at desc,first_post.id desc limit 1)) as method,
  coalesce(e.posted_by,(select first_post.posted_by from public.os_publication_events first_post
    where first_post.publish_record_id=e.publish_record_id and first_post.platform=e.platform
      and first_post.event='published' and first_post.created_at<=e.created_at
    order by first_post.created_at desc,first_post.id desc limit 1)) as posted_by,
  e.content_version,e.account_handle,e.external_account_id,
  e.format,coalesce(e.permalink,(
    select previous.permalink from public.os_publication_events previous
    where previous.publish_record_id=e.publish_record_id and previous.platform=e.platform
      and previous.permalink is not null and previous.created_at<=e.created_at
    order by previous.created_at desc,previous.id desc limit 1
  )) as permalink,e.external_id,e.error,
  r.title as content_title,r.brand,r.metadata->>'channel' as channel
from public.os_publication_events e
join public.os_records r on r.id=e.publish_record_id
where r.archived_at is null and e.event<>'metric_collected'
order by e.publish_record_id,e.platform,e.created_at desc,e.id desc;
revoke all on public.os_publication_log_v from public,anon,authenticated;
grant select on public.os_publication_log_v to authenticated,service_role;

-- Explicit operator action only. The migration itself never backfills rows.
create function public.os_backfill_publication_events() returns integer
language plpgsql security invoker set search_path=public,pg_temp as $$
declare inserted integer;
begin
  insert into public.os_publication_events(
    owner_id,publish_record_id,platform,event,method,posted_by,at,
    content_version,account_handle,external_account_id,format,permalink,external_id
  )
  select r.owner_id,r.id,
    coalesce(r.metadata->'account'->>'platform',r.metadata->>'platform'),
    'published',case when r.metadata->>'receiptSource'='manual' then 'manual' else 'os' end,
    case when coalesce(r.metadata->>'postedBy','') ~ '^[0-9a-f-]{36}$'
      then (r.metadata->>'postedBy')::uuid else null end,
    r.updated_at,
    r.version,r.metadata->'account'->>'handle',r.metadata->'account'->>'ownerId',
    r.metadata->>'format',coalesce(nullif(r.metadata->>'permalink',''),r.source_url),
    r.metadata->>'youtubeVideoId'
  from public.os_records r
  where r.record_type='content_publish' and r.status='published' and r.archived_at is null
    and r.owner_id is not null
    and coalesce(r.metadata->'account'->>'platform',r.metadata->>'platform') in ('instagram','threads','youtube')
    and not exists(select 1 from public.os_publication_events e
      where e.publish_record_id=r.id and e.platform=coalesce(r.metadata->'account'->>'platform',r.metadata->>'platform')
        and e.event='published');
  get diagnostics inserted=row_count;
  return inserted;
end $$;
revoke all on function public.os_backfill_publication_events() from public,anon,authenticated;
grant execute on function public.os_backfill_publication_events() to service_role;

-- One transaction keeps the content version and append-only human review in sync.
create function public.os_content_review_command(
  p_owner uuid,p_record uuid,p_expected_version integer,p_result text,
  p_checks jsonb,p_note text default null
) returns public.os_records
language plpgsql security invoker set search_path=public,pg_temp as $$
declare source public.os_records; saved public.os_records; unknown_count integer:=0; direct_count integer:=0;
begin
  select * into source from public.os_records
  where id=p_record and owner_id=p_owner and record_type='content_publish'
    and metadata->>'space'='personal' and archived_at is null for update;
  if not found then raise exception using errcode='PT404',message='CONTENT_NOT_FOUND'; end if;
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
    updated_by=p_owner
  where id=p_record and owner_id=p_owner and version=p_expected_version
  returning * into saved;
  if not found then raise exception using errcode='PT409',message='CONTENT_VERSION_CHANGED'; end if;
  insert into public.os_content_review_log(
    owner_id,publish_record_id,content_version,result,checks,
    license_unknown,overflow_slots,note,created_by
  ) values(
    p_owner,p_record,p_expected_version,p_result,p_checks,unknown_count,
    case when coalesce(source.metadata->>'overflowSlots','') ~ '^[0-9]{1,6}$'
      then (source.metadata->>'overflowSlots')::integer else 0 end,p_note,p_owner
  );
  return saved;
end $$;
revoke all on function public.os_content_review_command(uuid,uuid,integer,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.os_content_review_command(uuid,uuid,integer,text,jsonb,text) to service_role;

-- A human-confirmed schedule or manual publication keeps the record and
-- append-only publication event in one transaction.
create function public.os_content_publication_command(
  p_owner uuid,p_record uuid,p_expected_version integer,p_action text,
  p_starts_at timestamptz default null,p_platform text default null,
  p_permalink text default null
) returns public.os_records
language plpgsql security invoker set search_path=public,pg_temp as $$
declare source public.os_records; saved public.os_records;
begin
  select * into source from public.os_records
  where id=p_record and owner_id=p_owner and record_type='content_publish'
    and metadata->>'space'='personal' and archived_at is null for update;
  if not found then raise exception using errcode='PT404',message='CONTENT_NOT_FOUND'; end if;
  if source.version<>p_expected_version then raise exception using errcode='PT409',message='CONTENT_VERSION_CHANGED'; end if;
  if (source.status not in ('ready','scheduled') and not (
      p_action='manual_done' and source.status='published' and source.metadata->>'channel'='shorts'
    )) or not exists (
    select 1 from public.os_content_review_log review
    where review.owner_id=p_owner and review.publish_record_id=p_record
      and review.result='ready' and review.content_version<=source.version
  ) then raise exception using errcode='PT409',message='CONTENT_REVIEW_REQUIRED'; end if;
  if p_action='schedule' then
    if p_starts_at is null or p_starts_at<=now()
      then raise exception using errcode='PT422',message='FUTURE_TIME_REQUIRED'; end if;
    update public.os_records set status='scheduled',stage='scheduled',
      starts_at=p_starts_at,
      metadata=jsonb_set(source.metadata,'{scheduledAt}',to_jsonb(p_starts_at)),
      updated_by=p_owner
    where id=p_record and version=p_expected_version returning * into saved;
  elsif p_action='manual_done' then
    if p_platform not in ('instagram','threads','youtube') or
      (source.metadata->>'channel'='card' and p_platform<>'instagram') or
      (source.metadata->>'channel'='threads' and p_platform<>'threads') or
      (source.metadata->>'channel'='shorts' and p_platform not in ('instagram','youtube'))
      then raise exception using errcode='PT422',message='PLATFORM_INVALID'; end if;
    if exists(select 1 from public.os_publication_events event
      where event.publish_record_id=p_record and event.platform=p_platform
        and event.event='published')
      then raise exception using errcode='PT409',message='PLATFORM_ALREADY_PUBLISHED'; end if;
    update public.os_records set status='published',stage='published',
      source_url=coalesce(source.source_url,nullif(p_permalink,'')),updated_by=p_owner,
      metadata=source.metadata||jsonb_build_object(
        'postedBy',p_owner::text,'publishedAt',coalesce(source.metadata->>'publishedAt',now()::text),
        'receiptSource','manual','permalink',coalesce(source.metadata->>'permalink',p_permalink,''))
    where id=p_record and version=p_expected_version returning * into saved;
    insert into public.os_publication_events(
      owner_id,publish_record_id,platform,event,method,posted_by,at,
      content_version,format,permalink
    ) values(
      p_owner,p_record,p_platform,'published','manual',p_owner,now(),
      p_expected_version,source.metadata->>'channel',nullif(p_permalink,'')
    );
  else
    raise exception using errcode='PT422',message='PUBLICATION_ACTION_INVALID';
  end if;
  if saved.id is null then raise exception using errcode='PT409',message='CONTENT_VERSION_CHANGED'; end if;
  return saved;
end $$;
revoke all on function public.os_content_publication_command(uuid,uuid,integer,text,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.os_content_publication_command(uuid,uuid,integer,text,timestamptz,text,text) to service_role;

-- Serialize all claims for one owner, including parallel browsers and runs.
create function public.os_ai_claim_job(
  p_owner uuid,p_browser uuid,p_run uuid,p_job uuid,p_expected_version integer,p_via text
) returns public.os_records
language plpgsql security invoker set search_path=public,pg_temp as $$
declare run_row public.os_ai_runs; job_row public.os_records;
  rules_row public.os_ai_run_rules; taken integer; saved public.os_records;
begin
  perform 1 from public.os_profiles where id=p_owner for update;
  if not found then raise exception using errcode='PT404',message='OWNER_NOT_FOUND'; end if;
  select * into run_row from public.os_ai_runs
    where id=p_run and owner_id=p_owner and browser_id=p_browser and status='running'
      and via=p_via for update;
  if not found then raise exception using errcode='PT409',message='RUN_NOT_ACTIVE'; end if;
  select * into rules_row from public.os_ai_run_rules where owner_id=p_owner;
  if cardinality(run_row.job_ids)>=coalesce(rules_row.per_run,3)
    then raise exception using errcode='PT409',message='PER_RUN_LIMIT'; end if;
  select coalesce(sum(cardinality(job_ids)),0)::integer into taken
  from public.os_ai_runs where owner_id=p_owner
    and started_at>=date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  if taken>=coalesce(rules_row.daily_max,15)
    then raise exception using errcode='PT409',message='DAILY_LIMIT'; end if;
  select * into job_row from public.os_records where id=p_job and owner_id=p_owner
    and record_type='ai_job' and metadata->>'space'='personal'
    and status='backlog' and stage='queued' and version=p_expected_version
    and archived_at is null for update;
  if not found then return null; end if;
  update public.os_records set status='active',stage='running',updated_by=p_owner,
    metadata=job_row.metadata||jsonb_build_object(
      'runId',p_run::text,'browserId',p_browser::text,'via',p_via,
      'rush',false,'claimedAt',now()::text,
      'leaseExpiresAt',(now()+coalesce(rules_row.lease_minutes,120)*interval '1 minute')::text)
  where id=p_job and version=p_expected_version returning * into saved;
  update public.os_ai_runs set job_ids=array_append(job_ids,p_job)
    where id=p_run and owner_id=p_owner and status='running';
  return saved;
end $$;
revoke all on function public.os_ai_claim_job(uuid,uuid,uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.os_ai_claim_job(uuid,uuid,uuid,uuid,integer,text) to service_role;

create function public.os_ai_complete_job(
  p_owner uuid,p_browser uuid,p_run uuid,p_job uuid,p_expected_version integer,
  p_failed boolean,p_result jsonb,p_reason text
) returns public.os_records
language plpgsql security invoker set search_path=public,pg_temp as $$
declare run_row public.os_ai_runs; job_row public.os_records; saved public.os_records;
begin
  select * into run_row from public.os_ai_runs
    where id=p_run and owner_id=p_owner and browser_id=p_browser and status='running'
    for update;
  if not found then raise exception using errcode='PT409',message='RUN_NOT_ACTIVE'; end if;
  if not p_job=any(run_row.job_ids) then
    raise exception using errcode='PT409',message='JOB_RUN_MISMATCH'; end if;
  select * into job_row from public.os_records
    where id=p_job and owner_id=p_owner and record_type='ai_job'
      and metadata->>'space'='personal' and status='active' and stage='running'
      and metadata->>'runId'=p_run::text and metadata->>'browserId'=p_browser::text
      and version=p_expected_version and archived_at is null for update;
  if not found then raise exception using errcode='PT409',message='JOB_RUN_MISMATCH'; end if;
  if p_failed and length(trim(coalesce(p_reason,'')))=0 then
    raise exception using errcode='PT422',message='JOB_REASON_REQUIRED'; end if;
  if not p_failed and (p_result is null or jsonb_typeof(p_result)<>'object') then
    raise exception using errcode='PT422',message='JOB_RESULT_REQUIRED'; end if;
  update public.os_records set status=case when p_failed then 'blocked' else 'done' end,
    stage=case when p_failed then 'failed' else 'completed' end,updated_by=p_owner,
    metadata=job_row.metadata||jsonb_build_object(
      'result',p_result,'completedAt',now()::text,
      'failureCode',case when p_failed then 'worker_failed' else null end,
      'failureReason',case when p_failed then p_reason else null end)
  where id=p_job and version=p_expected_version returning * into saved;
  update public.os_ai_runs set
    done_count=done_count+case when p_failed then 0 else 1 end,
    blocked_count=blocked_count+case when p_failed then 1 else 0 end
  where id=p_run and owner_id=p_owner and browser_id=p_browser;
  return saved;
end $$;
revoke all on function public.os_ai_complete_job(uuid,uuid,uuid,uuid,integer,boolean,jsonb,text) from public,anon,authenticated;
grant execute on function public.os_ai_complete_job(uuid,uuid,uuid,uuid,integer,boolean,jsonb,text) to service_role;

create function public.os_ai_make_main_browser(p_owner uuid,p_browser uuid) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  perform 1 from public.os_profiles where id=p_owner for update;
  if not found then raise exception using errcode='PT404',message='OWNER_NOT_FOUND'; end if;
  perform 1 from public.os_ai_browsers
    where id=p_browser and owner_id=p_owner and removed_at is null for update;
  if not found then raise exception using errcode='PT404',message='BROWSER_NOT_FOUND'; end if;
  update public.os_ai_browsers set is_main=false
    where owner_id=p_owner and is_main and removed_at is null;
  update public.os_ai_browsers set is_main=true
    where id=p_browser and owner_id=p_owner and removed_at is null;
  return true;
end $$;
revoke all on function public.os_ai_make_main_browser(uuid,uuid) from public,anon,authenticated;
grant execute on function public.os_ai_make_main_browser(uuid,uuid) to service_role;

create function public.os_ai_register_browser(
  p_owner uuid,p_name text,p_os text,p_key_hash text
) returns public.os_ai_browsers
language plpgsql security invoker set search_path=public,pg_temp as $$
declare previous public.os_ai_browsers; main_needed boolean; registered public.os_ai_browsers;
begin
  perform 1 from public.os_profiles where id=p_owner for update;
  if not found then raise exception using errcode='PT404',message='OWNER_NOT_FOUND'; end if;
  select * into previous from public.os_ai_browsers where owner_id=p_owner
    and is_main and removed_at is null for update;
  main_needed:=previous.id is null or
    (previous.last_run_at is not null and previous.last_run_at<now()-interval '3 days');
  if main_needed and previous.id is not null then
    update public.os_ai_browsers set is_main=false where id=previous.id;
  end if;
  insert into public.os_ai_browsers(owner_id,name,os,key_hash,is_main)
  values(p_owner,p_name,p_os,p_key_hash,main_needed) returning * into registered;
  return registered;
end $$;
revoke all on function public.os_ai_register_browser(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.os_ai_register_browser(uuid,text,text,text) to service_role;

create function public.os_activate_personal_skill(p_owner uuid,p_skill uuid) returns public.os_records
language plpgsql security invoker set search_path=public,pg_temp as $$
declare selected public.os_records; saved public.os_records;
begin
  perform 1 from public.os_profiles where id=p_owner for update;
  if not found then raise exception using errcode='PT404',message='OWNER_NOT_FOUND'; end if;
  select * into selected from public.os_records where id=p_skill and owner_id=p_owner
    and record_type='skill' and metadata->>'space'='personal' and archived_at is null for update;
  if not found then raise exception using errcode='PT404',message='SKILL_NOT_FOUND'; end if;
  if coalesce(selected.metadata->>'process','')='' then
    raise exception using errcode='PT422',message='SKILL_PROCESS_REQUIRED'; end if;
  update public.os_records set metadata=jsonb_set(metadata,'{active}','false'::jsonb),updated_by=p_owner
    where owner_id=p_owner and record_type='skill' and metadata->>'space'='personal'
      and metadata->>'process'=selected.metadata->>'process' and metadata->>'active'='true'
      and id<>p_skill and archived_at is null;
  update public.os_records set metadata=jsonb_set(metadata,'{active}','true'::jsonb),
    status='ready',updated_by=p_owner where id=p_skill and owner_id=p_owner returning * into saved;
  return saved;
end $$;
revoke all on function public.os_activate_personal_skill(uuid,uuid) from public,anon,authenticated;
grant execute on function public.os_activate_personal_skill(uuid,uuid) to service_role;

-- Intentionally not called in this migration: existing menu policy rows are
-- migrated only after review, while application aliases keep them working.
create function public.os_migrate_content_automation_menus() returns integer
language plpgsql security invoker set search_path=public,pg_temp as $$
declare changed integer;
begin
  update public.os_member_menu_access m
     set allowed_menus=(
       select array(select distinct mapped from (
         select case item when '/automation/templates' then '/automation/settings'
                          when '/content/comments' then '/automation/performance'
                          when '/automation/library' then null else item end as mapped
         from unnest(m.allowed_menus) item
         union all
         select new_menu from unnest(array['/automation/topics','/automation/cardnews','/automation/shorts','/automation/threads']) new_menu
         where '/automation/review'=any(m.allowed_menus)
       ) entries where mapped is not null)
     ),version=version+1,updated_at=now()
  where m.allowed_menus is not null
    and m.allowed_menus && array['/automation/review','/automation/library','/automation/templates','/content/comments'];
  get diagnostics changed=row_count;
  return changed;
end $$;
revoke all on function public.os_migrate_content_automation_menus() from public,anon,authenticated;
grant execute on function public.os_migrate_content_automation_menus() to service_role;

-- Preserve the full HR + knowledge notification vocabulary while adding content reasons.
-- Reassert the shared notification contract after independently released HR
-- and knowledge migrations. An HR-only definition applied later can otherwise
-- reject knowledge reasons. Keep both menus compatible without changing rows,
-- table structure, policies, function privileges or the notification API.
create or replace function public.os_notification_guard() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then
    if old.record_type='notification' then raise exception using errcode='23514',message='NOTIFICATION_IMMUTABLE'; end if;
    return old;
  end if;
  if tg_op='UPDATE' and (old.record_type='notification' or new.record_type='notification') then
    if old.record_type<>new.record_type
      or (to_jsonb(new)-array['status','metadata','updated_by','updated_at','version']) is distinct from
         (to_jsonb(old)-array['status','metadata','updated_by','updated_at','version'])
      or (new.metadata-'readAt') is distinct from (old.metadata-'readAt') then
      raise exception using errcode='23514',message='NOTIFICATION_IMMUTABLE';
    end if;
  end if;
  if new.record_type<>'notification' then return new; end if;
  if new.title<>'업무 알림' or new.description<>'' or new.status not in ('read','unread')
    or new.owner_id is null
    or (new.owner_id=new.created_by and coalesce(new.metadata->>'reason','') not in ('scheduled','token_expiring','knowledge_review','knowledge_update','knowledge_access','knowledge_reminder','knowledge_mention','ai_result','computer_silent','publish_due'))
    or not exists(select 1 from public.os_profiles where id=new.owner_id and is_active)
    -- Preserve the already-deployed HR notification contract when that optional
    -- schema is present; installing this workspace must not disable other menus.
    or (coalesce(new.metadata->>'sourceType','') not in ('record','document','browser')
      and not (to_regclass('public.os_hr_employees') is not null
        and coalesce(new.metadata->>'sourceType','') in ('hr_employee','hr_leave','hr_promotion')))
    or coalesce(new.metadata->>'sourceId','') !~ '^[0-9a-f-]{36}$'
    or coalesce(new.metadata->>'reason','') not in ('assignment','review','approval','blocked','status_change','scheduled','token_expiring','knowledge_review','knowledge_update','knowledge_access','knowledge_reminder','knowledge_mention','ai_result','computer_silent','publish_due')
    or coalesce(new.metadata->>'dedupeKey','')=''
    or jsonb_typeof(new.metadata)<>'object'
    or exists(select 1 from jsonb_each(new.metadata) item where item.key not in ('sourceType','sourceId','reason','readAt','dedupeKey') or jsonb_typeof(item.value)<>'string')
    or (new.status='read' and coalesce(new.metadata->>'readAt','')='') then
    raise exception using errcode='23514',message='NOTIFICATION_INVALID';
  end if;
  return new;
end $$;

commit;
