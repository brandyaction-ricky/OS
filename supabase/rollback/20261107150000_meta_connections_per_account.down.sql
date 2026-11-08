-- Undo 20261107150000_meta_connections_per_account.sql: back to one Instagram / Threads connection per person and platform.
-- Works only while each person holds one account a platform — disconnect the extra accounts first (내 계정 › 채널 연결), or the key
-- fails on the repeated (owner_id, platform). Run the previous code first.
alter table public.os_meta_connections drop constraint os_meta_connections_pkey;
alter table public.os_meta_connections add constraint os_meta_connections_pkey primary key (owner_id, platform);

create or replace function public.os_threads_publication_claim(
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
