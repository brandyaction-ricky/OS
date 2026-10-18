-- Candidate integration test for 20261018020000_designated_approver_solo_canon.
-- NOT run by npm test. Run only on a DEV database that has the migration:
--   supabase db query --project-ref <dev-ref> --linked -f tests/designated-approver-solo-canon.sql
-- The designated approver (here also the canonical publisher, as in Production) takes their own
-- AI-written team document to canonical alone; another member still cannot name themselves, and
-- an approval that did not come from the designated approver still needs an independent publisher.
-- The final block always raises, so the whole transaction rolls back. Expect "failures=0".
begin;
set local statement_timeout = '60s';
create temp table ds(check_name text, ok boolean);
grant select, insert on ds to authenticated;
do $$
declare
  boss uuid; staff uuid; own_doc uuid := gen_random_uuid(); staff_doc uuid := gen_random_uuid(); c public.os_document_candidates; d public.os_documents;
  as_user text := 'set local role authenticated';
begin
  select id into boss from public.os_profiles where is_active and role = 'admin' and canonical_publisher and member_kind = 'staff' order by id limit 1;
  select id into staff from public.os_profiles where is_active and role <> 'admin' and member_kind = 'staff' order by id limit 1;
  if not exists (select 1 from public.os_approval_assignments where user_id = boss and kind = 'approver' and revoked_at is null) then
    insert into public.os_approval_assignments(user_id, kind, created_by) values (boss, 'approver', boss);
  end if;
  execute 'set local session_replication_role = replica';
  insert into public.os_documents(id, title, content_md, status, owner_id, source) values
    (own_doc, 'ds boss ai doc', 'body', 'team', boss, 'mcp'),
    (staff_doc, 'ds staff doc', 'body', 'team', staff, 'manual');
  execute 'set local session_replication_role = origin';

  -- 1) The designated approver alone: submit to self, approve, publish.
  perform set_config('request.jwt.claims', json_build_object('sub', boss, 'role', 'authenticated')::text, true);
  execute as_user;
  select * into c from public.os_submit_candidate(own_doc, (select current_version from public.os_documents where id = own_doc), boss, '02_Wiki/test', boss, current_date + 90);
  execute 'reset role';
  insert into ds values ('boss submits own AI doc to self', c.id is not null and c.requested_approver_id = boss and c.submitted_by = boss);
  select * into d from public.os_documents where id = own_doc;
  execute as_user;
  perform public.os_decide_candidate(c.id, d.current_version, 'approved', '');
  execute 'reset role';
  select * into d from public.os_documents where id = own_doc;
  insert into ds values ('boss approves own candidate', d.status = 'reviewed');
  execute as_user;
  perform public.os_publish_candidate(c.id, d.current_version);
  execute 'reset role';
  insert into ds values ('boss publishes own document', (select status = 'canonical' and folder = '02_Wiki/test' from public.os_documents where id = own_doc));
  insert into ds values ('publish logged as designated approval', exists(select 1 from public.os_document_events where document_id = own_doc and note = '지정 승인자 승인 후 최종 등록'));

  -- 2) Another member still cannot name themselves as approver.
  perform set_config('request.jwt.claims', json_build_object('sub', staff, 'role', 'authenticated')::text, true);
  execute as_user;
  begin
    perform public.os_submit_candidate(staff_doc, (select current_version from public.os_documents where id = staff_doc), staff, '02_Wiki/test', staff, current_date + 90);
    insert into ds values ('staff cannot self-approve', false);
  exception when others then insert into ds values ('staff cannot self-approve', sqlerrm like '%OS_APPROVER_INVALID%');
  end;
  execute 'reset role';

  -- 3) An approval that did not come from the designated approver still needs independence.
  perform set_config('request.jwt.claims', json_build_object('sub', staff, 'role', 'authenticated')::text, true);
  execute as_user;
  select * into c from public.os_submit_candidate(staff_doc, (select current_version from public.os_documents where id = staff_doc), boss, '02_Wiki/test', staff, current_date + 90);
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
  execute 'set local session_replication_role = replica';
  update public.os_document_candidates set status = 'approved', decided_by = staff, decided_at = now() where id = c.id;
  update public.os_documents set status = 'reviewed' where id = staff_doc;
  execute 'set local session_replication_role = origin';
  select * into d from public.os_documents where id = staff_doc;
  perform set_config('request.jwt.claims', json_build_object('sub', boss, 'role', 'authenticated')::text, true);
  execute as_user;
  begin
    perform public.os_publish_candidate(c.id, d.current_version);
    insert into ds values ('non-designated self-approval still blocked at publish', false);
  exception when others then insert into ds values ('non-designated self-approval still blocked at publish', sqlerrm like '%OS_INDEPENDENT_APPROVAL_REQUIRED%');
  end;
  execute 'reset role';

  raise exception 'DS_RESULT checks=% failures=% | %', (select count(*) from ds), (select count(*) from ds where not ok), (select string_agg(check_name, ' ; ') from ds where not ok);
end $$;
