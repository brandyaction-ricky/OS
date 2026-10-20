-- Candidate integration test for 20261018120000_threads_team_review.
-- NOT run by npm test. Run only on a DEV database, after the migration body (or with it
-- prepended inside this transaction). The final block always raises, so everything rolls
-- back. Expect "failures=0".
create temp table tr(check_name text, ok boolean);
grant select, insert on tr to authenticated;
do $$
declare
  owner uuid; reviewer uuid; member uuid; private_id uuid := gen_random_uuid(); shared_id uuid := gen_random_uuid();
  topic_id uuid := gen_random_uuid(); shared_topic uuid := gen_random_uuid(); saved public.os_records; n integer;
  as_user text := 'set local role authenticated';
  checks jsonb := '[{"key":"numbers","ok":true,"by":"me"},{"key":"message","ok":true,"by":"me"},{"key":"ending","ok":true,"by":"me"},{"key":"forbidden","ok":true,"by":"me"},{"key":"ads","ok":true,"by":"me"}]';
begin
  select id into owner from public.os_profiles where is_active and role <> 'admin' order by id limit 1;
  select id into reviewer from public.os_profiles where is_active and role = 'admin' order by id limit 1;
  select id into member from public.os_profiles where is_active and id not in (owner, reviewer) order by id limit 1;
  insert into public.os_content_reviewers(user_id, created_by) values (owner, reviewer), (reviewer, reviewer);
  insert into public.os_records(id, record_type, title, status, stage, owner_id, created_by, updated_by, metadata) values
    (topic_id, 'content_topic', 'tr topic', 'draft', 'confirmed', owner, owner, owner, '{"space":"personal","brief":{"one":"근거"}}'),
    (shared_topic, 'content_topic', 'tr shared topic', 'draft', 'confirmed', owner, owner, owner, '{"space":"personal","brief":{"one":"근거"}}'),
    (private_id, 'content_publish', 'tr private', 'review', 'review', owner, owner, owner, '{"space":"personal","channel":"threads","posts":["a"]}'),
    (shared_id, 'content_publish', 'tr shared', 'review', 'review', owner, owner, owner, '{"space":"personal","channel":"threads","posts":["a\n\nb"],"shared":"team"}');
  update public.os_records set parent_id = topic_id where id = private_id;
  update public.os_records set parent_id = shared_topic where id = shared_id;

  -- Another active member: reads the shared draft and its history, not the private one; cannot write.
  perform set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
  execute as_user;
  insert into tr values ('member reads shared draft', exists(select 1 from public.os_records where id = shared_id));
  insert into tr values ('member cannot read private draft', not exists(select 1 from public.os_records where id = private_id));
  insert into tr values ('member cannot read private topic', not exists(select 1 from public.os_records where id = topic_id));
  insert into tr values ('member reads shared history', exists(select 1 from public.os_record_events where record_id = shared_id));
  insert into tr values ('member cannot read private history', not exists(select 1 from public.os_record_events where record_id = private_id));
  update public.os_records set title = 'hijack' where id = shared_id;
  get diagnostics n = row_count;
  insert into tr values ('member cannot update shared draft', n = 0);
  execute 'reset role';

  -- Owner still reads and writes their own private draft.
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  execute as_user;
  insert into tr values ('owner reads private draft', exists(select 1 from public.os_records where id = private_id));
  insert into tr values ('owner reads private history', exists(select 1 from public.os_record_events where record_id = private_id));
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);

  -- Review command (server, service role): non-reviewer refused, reviewer recorded.
  begin
    perform public.os_content_review_command(owner, shared_id, (select version from public.os_records where id = shared_id), 'ready', checks, null, member);
    insert into tr values ('non-reviewer cannot approve shared', false);
  exception when others then insert into tr values ('non-reviewer cannot approve shared', sqlerrm = 'TEAM_REVIEWER_REQUIRED');
  end;
  begin
    perform public.os_content_review_command(owner, private_id, (select version from public.os_records where id = private_id), 'ready', checks, null, reviewer);
    insert into tr values ('reviewer cannot touch private draft', false);
  exception when others then insert into tr values ('reviewer cannot touch private draft', sqlerrm = 'CONTENT_NOT_FOUND');
  end;
  begin
    perform public.os_content_review_command(owner, shared_id, 1, 'ready', checks, null, reviewer);
    insert into tr values ('stale version refused', (select version from public.os_records where id = shared_id) = 1);
  exception when others then insert into tr values ('stale version refused', sqlerrm = 'CONTENT_VERSION_CHANGED');
  end;
  saved := public.os_content_review_command(owner, shared_id, (select version from public.os_records where id = shared_id), 'ready', checks, null, reviewer);
  insert into tr values ('reviewer approves shared', saved.status = 'ready' and saved.updated_by = reviewer and saved.owner_id = owner);
  insert into tr values ('review log names the reviewer', exists(select 1 from public.os_content_review_log where publish_record_id = shared_id and created_by = reviewer and result = 'ready'));
  insert into tr values ('approval is not publication', saved.status <> 'published' and saved.starts_at is null);
  -- Owner's own private draft: unchanged six-argument call still works.
  saved := public.os_content_review_command(owner, private_id, (select version from public.os_records where id = private_id), 'changes', checks, '고칠 점');
  insert into tr values ('owner six-arg call still works', saved.status = 'blocked' and saved.updated_by = owner);
  -- An owner who is not a named reviewer cannot approve their shared draft.
  delete from public.os_content_reviewers where user_id = owner;
  update public.os_records set status = 'review' where id = shared_id;
  begin
    perform public.os_content_review_command(owner, shared_id, (select version from public.os_records where id = shared_id), 'ready', checks);
    insert into tr values ('non-reviewer owner cannot approve shared', false);
  exception when others then insert into tr values ('non-reviewer owner cannot approve shared', sqlerrm = 'TEAM_REVIEWER_REQUIRED');
  end;

  -- Same topic request id returns a conflict (the server then returns the existing topic).
  insert into public.os_records(record_type, title, status, stage, owner_id, created_by, updated_by, metadata)
    values ('content_topic', 'tr req', 'draft', 'candidate', owner, owner, owner, '{"space":"personal","requestId":"tr-request-0001"}');
  begin
    insert into public.os_records(record_type, title, status, stage, owner_id, created_by, updated_by, metadata)
      values ('content_topic', 'tr req 2', 'draft', 'candidate', owner, owner, owner, '{"space":"personal","requestId":"tr-request-0001"}');
    insert into tr values ('duplicate request id refused', false);
  exception when unique_violation then insert into tr values ('duplicate request id refused', true);
  end;

  -- Review notes are append-only.
  insert into public.os_content_review_comments(publish_record_id, author_id, content_version, body) values (shared_id, member, 1, '의견');
  begin
    update public.os_content_review_comments set body = 'x' where publish_record_id = shared_id;
    insert into tr values ('comments append-only', false);
  exception when others then insert into tr values ('comments append-only', sqlerrm = 'CONTENT_HISTORY_APPEND_ONLY');
  end;

  raise exception 'TR_RESULT checks=% failures=% | %', (select count(*) from tr), (select count(*) from tr where not ok), (select string_agg(check_name, ' ; ') from tr where not ok);
end $$;
