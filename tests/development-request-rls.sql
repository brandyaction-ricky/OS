-- Run only after migration 013, using the database administrator connection.
-- Every request/event row created below is rolled back. No passwords are read.
begin;

do $$
declare reporter uuid; administrator uuid;
begin
  select id into reporter from public.os_profiles where is_active and role = 'member' limit 1;
  select id into administrator from public.os_profiles where is_active and role = 'admin' limit 1;
  if reporter is null or administrator is null then
    raise exception 'QA requires one active member and one active admin';
  end if;
  perform set_config('qa.reporter', reporter::text, true);
  perform set_config('qa.administrator', administrator::text, true);
  perform set_config('qa.request', gen_random_uuid()::text, true);
  perform set_config('request.jwt.claim.sub', reporter::text, true);
end;
$$;

set local role authenticated;
do $$
declare denied boolean;
begin
  insert into public.os_records (id, record_type, title, status, created_by, updated_by, owner_id, metadata)
  values (current_setting('qa.request')::uuid, 'ai_job', '__development_request_guard_qa__', 'backlog', auth.uid(), auth.uid(), auth.uid(),
    '{"kind":"development_request","category":"bug","pageUrl":"/knowledge","steps":"QA"}'::jsonb);
  update public.os_records set description = 'reporter backlog edit' where id = current_setting('qa.request')::uuid;

  denied := false;
  begin
    update public.os_records set status = 'done', metadata = metadata || '{"resolution":"forged result"}'::jsonb where id = current_setting('qa.request')::uuid;
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Reporter could forge completion'; end if;

  denied := false;
  begin
    update public.os_records set metadata = metadata - 'kind' where id = current_setting('qa.request')::uuid;
  exception when check_violation then denied := true;
  end;
  if not denied then raise exception 'Reporter could remove the request marker'; end if;

  denied := false;
  begin
    update public.os_records set metadata = metadata || '{"pageUrl":"javascript:alert(1)"}'::jsonb where id = current_setting('qa.request')::uuid;
  exception when check_violation then denied := true;
  end;
  if not denied then raise exception 'Executable URL accepted'; end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', current_setting('qa.administrator'), true);
set local role authenticated;
do $$
declare denied boolean;
begin
  denied := false;
  begin
    update public.os_records set status = 'done' where id = current_setting('qa.request')::uuid;
  exception when check_violation then denied := true;
  end;
  if not denied then raise exception 'Admin could complete without resolution'; end if;
  update public.os_records set status = 'done', metadata = metadata || '{"resolution":"사용 방법 안내로 해결"}'::jsonb where id = current_setting('qa.request')::uuid;
  if not found then raise exception 'Admin could not resolve employee request'; end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', current_setting('qa.reporter'), true);
set local role authenticated;
do $$
begin
  update public.os_records set status = 'backlog' where id = current_setting('qa.request')::uuid;
  if not found then raise exception 'Reporter could not reopen own request'; end if;
  if not exists (select 1 from public.os_records where id = current_setting('qa.request')::uuid and status = 'backlog' and metadata->>'resolution' = '사용 방법 안내로 해결') then
    raise exception 'Reopen did not preserve the existing resolution';
  end if;
end;
$$;

reset role;
select 'development request database guards passed; QA rows will be rolled back' as result;
rollback;
