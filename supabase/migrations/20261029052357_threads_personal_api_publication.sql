-- Official Threads API for reviewed personal text chains. No data moves or live activation.
begin;
create table public.os_threads_publication_runs (
  publication_id uuid primary key references public.os_records(id),
  owner_id uuid not null references public.os_profiles(id),
  source_version integer not null check(source_version>0),
  review_id uuid not null references public.os_content_review_log(id),
  posts jsonb not null check(jsonb_typeof(posts)='array' and jsonb_array_length(posts) between 1 and 30),
  account_owner_id uuid not null references public.os_profiles(id),
  external_account_id text not null,
  account_name text not null,
  mode text not null check(mode in ('mock','live')),
  state text not null check(state in ('running','retryable','uncertain','published','mock_complete')),
  operation_id uuid not null,
  checkpoint jsonb not null default '{"receipts":[]}'::jsonb,
  error_code text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.os_threads_publication_runs enable row level security;
revoke all on public.os_threads_publication_runs from public,anon,authenticated;
grant select,insert,update on public.os_threads_publication_runs to service_role;
create index os_threads_publication_runs_owner_idx on public.os_threads_publication_runs(owner_id,updated_at desc);

-- Only the trigger needs privileged read access to server-only run state. Keep
-- it outside the exposed API schema, with no callable public/user grants.
create schema if not exists os_internal;
revoke all on schema os_internal from public,anon,authenticated;
create function os_internal.guard_threads_publication_source() returns trigger
language plpgsql security definer set search_path='' as $$
declare run public.os_threads_publication_runs; expected_meta jsonb; link text;
begin
  select * into run from public.os_threads_publication_runs where publication_id=old.id;
  if not found then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if run.state in ('running','uncertain','published') or jsonb_array_length(run.checkpoint->'receipts')>0 and run.mode='live' then
    -- The completion RPC first records its receipts, then performs exactly this
    -- source transition in the same transaction. No other edit is exempted.
    link:=coalesce(run.checkpoint->'receipts'->0->>'permalink','');
    expected_meta:=old.metadata||jsonb_build_object('postedBy',run.owner_id::text,
      'publishedAt',run.completed_at::text,'receiptSource','os','permalink',link,
      'threadsApiPublished',true);
    if tg_op='UPDATE' and current_setting('role',true)='service_role'
      and run.state='published' and old.status in ('ready','scheduled')
      and old.version=run.source_version and new.status='published' and new.stage='published'
      and new.metadata=expected_meta and new.source_url is not distinct from nullif(link,'')
      and new.updated_by=run.owner_id
      and (to_jsonb(new)-array['status','stage','source_url','metadata','updated_by','updated_at','version'])
        =(to_jsonb(old)-array['status','stage','source_url','metadata','updated_by','updated_at','version']) then
      return new;
    end if;
    raise exception using errcode='PT409',message='THREADS_PUBLICATION_LOCKED';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function os_internal.guard_threads_publication_source() from public,anon,authenticated;
create trigger os_threads_publication_source_guard before update or delete on public.os_records
for each row execute function os_internal.guard_threads_publication_source();

-- Lock the source before its run row in every RPC. This also serializes with
-- review/reopen/adopt and prevents text changes between approval and dispatch.
create function public.os_threads_publication_claim(
  p_owner uuid,p_record uuid,p_expected_version integer,p_account_owner uuid,
  p_external_account_id text,p_account_name text,p_mode text,p_operation uuid
) returns public.os_threads_publication_runs
language plpgsql security invoker set search_path=public,pg_temp as $$
declare source public.os_records; run public.os_threads_publication_runs;
  review public.os_content_review_log; approved jsonb; connection public.os_meta_connections;
begin
  select * into source from public.os_records where id=p_record and owner_id=p_owner
    and record_type='content_publish' and metadata->>'space'='personal'
    and metadata->>'channel'='threads' and archived_at is null for update;
  if not found then raise exception using errcode='PT404',message='THREADS_SOURCE_NOT_FOUND'; end if;
  if not exists(select 1 from public.os_profiles where id=p_owner and is_active)
    then raise exception using errcode='PT403',message='THREADS_OWNER_INACTIVE'; end if;
  if p_mode not in ('mock','live') or p_operation is null
    then raise exception using errcode='PT422',message='THREADS_PUBLICATION_INPUT'; end if;
  select * into connection from public.os_meta_connections where owner_id=p_account_owner and platform='threads';
  if not found or not (p_account_owner=p_owner or connection.team_shared)
    or connection.external_account_id is distinct from p_external_account_id
    or connection.account_name is distinct from p_account_name
    or connection.status<>'connected' or connection.token_expires_at<=now()
    or (connection.account_type='MOCK')<>(p_mode='mock')
    or not exists(select 1 from public.os_profiles where id=p_account_owner and is_active)
    then raise exception using errcode='PT403',message='THREADS_ACCOUNT_UNAVAILABLE'; end if;
  select * into run from public.os_threads_publication_runs where publication_id=p_record for update;
  if found and run.state='published' then
    if run.account_owner_id<>p_account_owner or run.external_account_id<>p_external_account_id or run.mode<>p_mode
      then raise exception using errcode='PT409',message='THREADS_ACCOUNT_CHANGED'; end if;
    return run;
  end if;
  if source.version<>p_expected_version then raise exception using errcode='PT409',message='THREADS_SOURCE_CHANGED'; end if;
  if run.publication_id is not null and run.state in ('running','uncertain')
    then raise exception using errcode='PT409',message='THREADS_RESULT_UNCERTAIN'; end if;
  if source.status not in ('ready','scheduled')
    then raise exception using errcode='PT409',message='THREADS_REVIEW_REQUIRED'; end if;
  if jsonb_typeof(source.metadata->'posts') is distinct from 'array'
    or jsonb_array_length(source.metadata->'posts') not between 1 and 30
    then raise exception using errcode='PT422',message='THREADS_POSTS_INVALID'; end if;
  if exists(select 1 from jsonb_array_elements(source.metadata->'posts') post
    where jsonb_typeof(post)<>'string' or length(btrim(post#>>'{}'))=0 or char_length(post#>>'{}')>500)
    then raise exception using errcode='PT422',message='THREADS_POSTS_INVALID'; end if;
  select * into review from public.os_content_review_log where publish_record_id=p_record and owner_id=p_owner
    order by created_at desc,id desc limit 1;
  if not found or review.result<>'ready' then raise exception using errcode='PT409',message='THREADS_REVIEW_REQUIRED'; end if;
  -- Review history is append-only. Compare actual approved record text instead
  -- of trusting a client-writable flag or any old review of this record.
  select snapshot into approved from public.os_record_events where record_id=p_record
    and snapshot->>'version'=(review.content_version+1)::text and snapshot->>'status'='ready'
    order by id desc limit 1;
  if approved is null or approved->'metadata'->'posts' is distinct from source.metadata->'posts'
    or approved->>'title' is distinct from source.title
    or approved->>'description' is distinct from source.description
    or approved->>'parent_id' is distinct from source.parent_id::text
    then raise exception using errcode='PT409',message='THREADS_REVIEW_REQUIRED'; end if;
  if run.publication_id is not null and run.mode='live' and jsonb_array_length(run.checkpoint->'receipts')>0 then
    if run.account_owner_id<>p_account_owner or run.external_account_id<>p_external_account_id or run.mode<>p_mode
      or run.posts<>source.metadata->'posts' or run.source_version<>source.version or run.review_id<>review.id
      then raise exception using errcode='PT409',message='THREADS_SNAPSHOT_CHANGED'; end if;
    update public.os_threads_publication_runs set state='running',operation_id=p_operation,error_code=null,updated_at=now()
      where publication_id=p_record returning * into run;
  else
    if exists(select 1 from public.os_publication_events where publish_record_id=p_record and platform='threads' and event='published')
      then raise exception using errcode='PT409',message='THREADS_ALREADY_PUBLISHED'; end if;
    if run.publication_id is not null and run.state='retryable' and run.mode=p_mode
      and run.posts=source.metadata->'posts' and run.source_version=source.version and run.review_id=review.id
      and run.account_owner_id=p_account_owner and run.external_account_id=p_external_account_id then
      update public.os_threads_publication_runs set state='running',operation_id=p_operation,error_code=null,updated_at=now()
        where publication_id=p_record returning * into run;
    else
      insert into public.os_threads_publication_runs(publication_id,owner_id,source_version,review_id,posts,
        account_owner_id,external_account_id,account_name,mode,state,operation_id)
      values(p_record,p_owner,source.version,review.id,source.metadata->'posts',p_account_owner,p_external_account_id,p_account_name,p_mode,'running',p_operation)
      on conflict(publication_id) do update set source_version=excluded.source_version,review_id=excluded.review_id,
        posts=excluded.posts,account_owner_id=excluded.account_owner_id,external_account_id=excluded.external_account_id,
        account_name=excluded.account_name,mode=excluded.mode,state='running',operation_id=excluded.operation_id,
        checkpoint='{"receipts":[]}'::jsonb,error_code=null,started_at=now(),updated_at=now(),completed_at=null
      returning * into run;
    end if;
  end if;
  return run;
end $$;

create function public.os_threads_publication_checkpoint(p_owner uuid,p_record uuid,p_operation uuid,p_checkpoint jsonb)
returns public.os_threads_publication_runs language plpgsql security invoker set search_path=public,pg_temp as $$
declare run public.os_threads_publication_runs; previous_count integer; next_count integer;
begin
  perform 1 from public.os_records where id=p_record and owner_id=p_owner for update;
  select * into run from public.os_threads_publication_runs where publication_id=p_record and owner_id=p_owner for update;
  if not found or run.operation_id<>p_operation or run.state<>'running'
    then raise exception using errcode='PT409',message='THREADS_OPERATION_CHANGED'; end if;
  if jsonb_typeof(p_checkpoint->'receipts') is distinct from 'array'
    then raise exception using errcode='PT422',message='THREADS_CHECKPOINT_INVALID'; end if;
  previous_count:=jsonb_array_length(run.checkpoint->'receipts'); next_count:=jsonb_array_length(p_checkpoint->'receipts');
  if next_count<previous_count or next_count>previous_count+1 or next_count>jsonb_array_length(run.posts)
    or exists(select 1 from jsonb_array_elements(run.checkpoint->'receipts') with ordinality receipt(value,n)
      where p_checkpoint->'receipts'->(n::integer-1) is distinct from receipt.value)
    or exists(select 1 from jsonb_array_elements(p_checkpoint->'receipts') receipt
      where jsonb_typeof(receipt->'id') is distinct from 'string' or length(coalesce(receipt->>'id',''))=0
        or jsonb_typeof(receipt->'permalink') is distinct from 'string')
    then raise exception using errcode='PT422',message='THREADS_CHECKPOINT_INVALID'; end if;
  if p_checkpoint ? 'container' and (jsonb_typeof(p_checkpoint->'container') is distinct from 'object'
    or p_checkpoint->'container'->>'phase' not in ('created','publishing')
    or coalesce(p_checkpoint->'container'->>'id','')=''
    or p_checkpoint->'container'->>'index' is distinct from next_count::text)
    then raise exception using errcode='PT422',message='THREADS_CHECKPOINT_INVALID'; end if;
  update public.os_threads_publication_runs set checkpoint=p_checkpoint,updated_at=now()
    where publication_id=p_record returning * into run;
  return run;
end $$;

create function public.os_threads_publication_finish(p_owner uuid,p_record uuid,p_operation uuid,p_error_code text default null,p_uncertain boolean default false)
returns public.os_threads_publication_runs language plpgsql security invoker set search_path=public,pg_temp as $$
declare run public.os_threads_publication_runs; source public.os_records; complete boolean; link text;
begin
  select * into source from public.os_records where id=p_record and owner_id=p_owner for update;
  select * into run from public.os_threads_publication_runs where publication_id=p_record and owner_id=p_owner for update;
  if not found or run.operation_id<>p_operation then raise exception using errcode='PT409',message='THREADS_OPERATION_CHANGED'; end if;
  if run.state in ('published','mock_complete') then return run; end if;
  if run.state<>'running' then raise exception using errcode='PT409',message='THREADS_OPERATION_CHANGED'; end if;
  complete:=p_error_code is null and jsonb_array_length(run.checkpoint->'receipts')=jsonb_array_length(run.posts)
    and not (run.checkpoint ? 'container');
  if p_error_code is null and not complete then raise exception using errcode='PT409',message='THREADS_RECEIPTS_INCOMPLETE'; end if;
  update public.os_threads_publication_runs set
    state=case when complete then case when mode='live' then 'published' else 'mock_complete' end
      when p_uncertain or checkpoint->'container'->>'phase'='publishing' then 'uncertain' else 'retryable' end,
    error_code=left(p_error_code,100),completed_at=case when complete then now() else null end,updated_at=now()
    where publication_id=p_record returning * into run;
  if complete and run.mode='live' then
    link:=coalesce(run.checkpoint->'receipts'->0->>'permalink','');
    update public.os_records set status='published',stage='published',source_url=nullif(link,''),updated_by=p_owner,
      metadata=source.metadata||jsonb_build_object('postedBy',p_owner::text,'publishedAt',run.completed_at::text,
        'receiptSource','os','permalink',link,'threadsApiPublished',true)
      where id=p_record and version=run.source_version;
    if not found then raise exception using errcode='PT409',message='THREADS_SOURCE_CHANGED'; end if;
    insert into public.os_publication_events(owner_id,publish_record_id,platform,event,method,posted_by,content_version,
      account_handle,external_account_id,format,permalink,external_id)
    values(p_owner,p_record,'threads','published','os',p_owner,run.source_version,run.account_name,run.external_account_id,
      'threads',nullif(link,''),run.checkpoint->'receipts'->0->>'id');
  elsif not complete and run.mode='live' then
    insert into public.os_publication_events(owner_id,publish_record_id,platform,event,method,posted_by,content_version,
      account_handle,external_account_id,format,error)
    values(p_owner,p_record,'threads','failed','os',p_owner,run.source_version,run.account_name,run.external_account_id,'threads',
      jsonb_build_object('code',run.error_code,'publishedCount',jsonb_array_length(run.checkpoint->'receipts'),'state',run.state));
  end if;
  return run;
end $$;
revoke all on function public.os_threads_publication_claim(uuid,uuid,integer,uuid,text,text,text,uuid),
  public.os_threads_publication_checkpoint(uuid,uuid,uuid,jsonb),public.os_threads_publication_finish(uuid,uuid,uuid,text,boolean)
  from public,anon,authenticated;
grant execute on function public.os_threads_publication_claim(uuid,uuid,integer,uuid,text,text,text,uuid),
  public.os_threads_publication_checkpoint(uuid,uuid,uuid,jsonb),public.os_threads_publication_finish(uuid,uuid,uuid,text,boolean)
  to service_role;
commit;
