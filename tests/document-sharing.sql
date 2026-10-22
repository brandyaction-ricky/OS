-- Candidate integration test for 20261022090000_document_sharing.
-- NOT run by npm test. Run only on a DEV database, after the migration body (or with it
-- prepended inside this transaction). The final block always raises, so everything rolls
-- back. Expect "failures=0".
create temp table ds(check_name text, ok boolean);
grant select, insert on ds to authenticated;
do $$
#variable_conflict use_variable
declare
  owner uuid; reader uuid; other uuid; note uuid := gen_random_uuid(); team_doc uuid := gen_random_uuid(); n integer;
  as_user text := 'set local role authenticated';
begin
  select id into owner from public.os_profiles where is_active and member_kind = 'staff' and role <> 'admin' order by id limit 1;
  select id into reader from public.os_profiles where is_active and member_kind = 'staff' and role <> 'admin' and id <> owner order by id limit 1;
  select id into other from public.os_profiles where is_active and member_kind = 'staff' and role <> 'admin' and id not in (owner, reader) order by id limit 1;
  execute 'set local session_replication_role = replica';
  insert into public.os_documents(id, title, content_md, status, owner_id, source) values
    (note, 'ds shared note', 'body', 'draft', owner, 'manual'),
    (team_doc, 'ds team doc', 'body', 'team', owner, 'manual');
  execute 'set local session_replication_role = origin';

  perform set_config('request.jwt.claims', json_build_object('sub', reader, 'role', 'authenticated')::text, true);
  execute as_user;
  insert into ds values ('reader cannot read before sharing', not exists(select 1 from public.os_documents where id = note));
  execute 'reset role';

  -- Only the owner shares, only a personal note, never with themselves.
  begin perform public.os_share_note_readers(reader, note, array[other]); insert into ds values ('non-owner cannot share', false);
  exception when others then insert into ds values ('non-owner cannot share', sqlerrm = 'NOTE_SHARE_OWNER_ONLY'); end;
  begin perform public.os_share_note_readers(owner, team_doc, array[reader]); insert into ds values ('team document is not shared this way', false);
  exception when others then insert into ds values ('team document is not shared this way', sqlerrm = 'NOTE_SHARE_DRAFT_ONLY'); end;
  begin perform public.os_share_note_readers(owner, note, array[owner]); insert into ds values ('owner is not a reader', false);
  exception when others then insert into ds values ('owner is not a reader', sqlerrm = 'READER_INVALID'); end;
  perform public.os_share_note_readers(owner, note, array[reader]);
  insert into ds values ('share event logged', exists(select 1 from public.os_document_events e where e.document_id = note and e.note like '지정한 직원 1명%'));

  perform set_config('request.jwt.claims', json_build_object('sub', reader, 'role', 'authenticated')::text, true);
  execute as_user;
  insert into ds values ('reader reads shared note', exists(select 1 from public.os_documents where id = note));
  insert into ds values ('reader passes page read', public.os_workspace_page_read(note));
  update public.os_documents set title = 'hijack' where id = note;
  get diagnostics n = row_count;
  insert into ds values ('reader cannot edit', n = 0);
  insert into ds values ('reader cannot see share links table', not has_table_privilege('authenticated', 'public.os_document_share_links', 'select'));
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', other, 'role', 'authenticated')::text, true);
  execute as_user;
  insert into ds values ('another member still cannot read', not exists(select 1 from public.os_documents where id = note));
  execute 'reset role';

  -- A trashed note goes back to owner-only.
  execute 'set local session_replication_role = replica';
  update public.os_documents set status = 'archived', archived_from_status = 'draft' where id = note;
  execute 'set local session_replication_role = origin';
  perform set_config('request.jwt.claims', json_build_object('sub', reader, 'role', 'authenticated')::text, true);
  execute as_user;
  insert into ds values ('trashed note hidden from reader', not exists(select 1 from public.os_documents where id = note));
  execute 'reset role';
  execute 'set local session_replication_role = replica';
  update public.os_documents set status = 'draft', archived_from_status = null where id = note;
  execute 'set local session_replication_role = origin';

  -- Unsharing removes access.
  perform public.os_share_note_readers(owner, note, array[]::uuid[]);
  perform set_config('request.jwt.claims', json_build_object('sub', reader, 'role', 'authenticated')::text, true);
  execute as_user;
  insert into ds values ('unshared note hidden again', not exists(select 1 from public.os_documents where id = note));
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);

  -- External link expiry is bounded.
  begin
    insert into public.os_document_share_links(document_id, token_hash, created_by, expires_at) values (note, repeat('a', 64), owner, now() + interval '40 days');
    insert into ds values ('link longer than 31 days refused', false);
  exception when check_violation then insert into ds values ('link longer than 31 days refused', true); end;

  raise exception 'DS_RESULT checks=% failures=% | %', (select count(*) from ds), (select count(*) from ds where not ok), (select string_agg(check_name, ' ; ') from ds where not ok);
end $$;
