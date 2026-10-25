-- Candidate integration test for 20261025120000_team_meeting_archive.
-- NOT run by npm test. Run only on a DEV database, after the migration body (or with it
-- prepended inside this transaction). The final block always raises, so everything rolls
-- back. Expect "failures=0".
create temp table ma(check_name text, ok boolean);
grant select, insert on ma to authenticated;
do $$
#variable_conflict use_variable
declare
  owner uuid; other uuid; meeting uuid := gen_random_uuid(); busy uuid := gen_random_uuid(); page uuid := gen_random_uuid(); r jsonb;
begin
  select id into owner from public.os_profiles where is_active and member_kind = 'staff' and role <> 'admin' order by id limit 1;
  select id into other from public.os_profiles where is_active and member_kind = 'staff' and role <> 'admin' and id <> owner order by id limit 1;
  execute 'set local session_replication_role = replica';
  insert into public.os_records(id, record_type, title, status, owner_id, created_by, updated_by, metadata) values
    (meeting, 'meeting', 'ma test meeting', 'planned', owner, owner, owner, '{"workspace":"knowledge","visibility":"team"}'),
    (busy, 'meeting', 'ma busy meeting', 'planned', owner, owner, owner, '{"workspace":"knowledge","visibility":"team"}');
  insert into public.os_records(record_type, title, status, owner_id, created_by, updated_by, metadata) values
    ('task', 'ma linked task', 'todo', owner, owner, owner, jsonb_build_object('meetingId', busy));
  insert into public.os_documents(id, title, content_md, status, owner_id, source, meeting_record_id) values (page, 'ma meeting page', 'x', 'team', owner, 'manual', meeting);
  execute 'set local session_replication_role = origin';

  perform set_config('request.jwt.claims', json_build_object('sub', other, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.os_team_archive_meeting(meeting, 1, '시험'); insert into ma values ('non-owner refused', false);
  exception when others then insert into ma values ('non-owner refused', sqlerrm = 'OS_MEETING_ARCHIVE_DENIED'); end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.os_team_archive_meeting(meeting, 1, ''); insert into ma values ('reason required', false);
  exception when others then insert into ma values ('reason required', sqlerrm = 'OS_REASON_REQUIRED'); end;
  begin perform public.os_team_archive_meeting(meeting, 99, '시험'); insert into ma values ('stale version refused', false);
  exception when others then insert into ma values ('stale version refused', sqlerrm = 'OS_VERSION_CONFLICT'); end;
  begin perform public.os_team_archive_meeting(busy, 1, '시험'); insert into ma values ('meeting with live task refused', false);
  exception when others then insert into ma values ('meeting with live task refused', sqlerrm = 'OS_MEETING_HAS_LINKED_WORK'); end;
  r := public.os_team_archive_meeting(meeting, 1, '시험 회의');
  execute 'reset role';
  insert into ma values ('returns archived', (r->>'archived')::boolean);
  insert into ma values ('meeting archived with reason', exists(select 1 from public.os_records where id = meeting and archived_at is not null and metadata->>'archivedReason' = '시험 회의'));
  insert into ma values ('page in trash, origin kept', exists(select 1 from public.os_documents where id = page and status = 'archived' and archived_from_status = 'team' and archived_by = owner));
  insert into ma values ('event logged', exists(select 1 from public.os_knowledge_events where target_id = meeting and action = 'meeting_archive'));
  insert into ma values ('guard still blocks plain updates', true);
  begin update public.os_records set title = 'x' where id = busy; update ma set ok = false where check_name = 'guard still blocks plain updates';
  exception when others then null; end;

  raise exception 'MA_RESULT checks=% failures=% | %', (select count(*) from ma), (select count(*) from ma where not ok), (select string_agg(check_name, ' ; ') from ma where not ok);
end $$;
