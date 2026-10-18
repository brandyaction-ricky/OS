-- Candidate integration test for 20261017020000_canonical_reader_scope.
-- NOT run by npm test. Run only on a DEV database that has the migration:
--   supabase db query --project-ref <dev-ref> --linked -f tests/canonical-reader-scope.sql
-- Creates one restricted canonical document (with a version and a search chunk)
-- and checks who can read it through RLS, plus the admin-only setter. The final
-- block always raises, so the whole transaction rolls back. Expect "failures=0".
begin;
set local statement_timeout = '60s';
create temp table rs(check_name text, ok boolean);
grant select, insert on rs to authenticated;
do $$
declare
  admin_id uuid; owner_id uuid; steward_id uuid; reader_id uuid; outsider_id uuid;
  doc uuid := gen_random_uuid(); open_doc uuid := gen_random_uuid(); who uuid; n bigint; d public.os_documents;
begin
  select id into admin_id from public.os_profiles where is_active and role = 'admin' order by id limit 1;
  select id into owner_id from public.os_profiles where is_active and role <> 'admin' and member_kind = 'staff' order by id limit 1;
  select id into steward_id from public.os_profiles where is_active and role <> 'admin' and member_kind = 'staff' and id <> owner_id order by id limit 1;
  select id into reader_id from public.os_profiles where is_active and role <> 'admin' and member_kind = 'staff' and id not in (owner_id, steward_id) order by id limit 1;
  select id into outsider_id from public.os_profiles where is_active and role <> 'admin' and member_kind = 'staff' and id not in (owner_id, steward_id, reader_id) order by id limit 1;
  execute 'set local session_replication_role = replica';
  insert into public.os_documents(id, title, content_md, status, owner_id, steward_id) values
    (doc, 'rs restricted canon', 'secret body', 'canonical', owner_id, steward_id),
    (open_doc, 'rs open canon', 'open body', 'canonical', owner_id, steward_id);
  insert into public.os_document_versions(document_id, version_no, title, content_md, author_id) values (doc, 1, 'rs restricted canon', 'secret body', owner_id);
  insert into public.os_document_chunks(document_id, chunk_index, chunk_text) values (doc, 0, 'secret body');
  execute 'set local session_replication_role = origin';

  -- Setter: members are refused, admins succeed.
  begin perform public.os_set_document_readers(outsider_id, doc, 1, 'restricted', array[reader_id]); insert into rs values ('member cannot set readers', false);
  exception when others then insert into rs values ('member cannot set readers', sqlerrm like '%ADMIN_REQUIRED%'); end;
  select * into d from public.os_documents where id = doc;
  perform public.os_set_document_readers(admin_id, doc, d.current_version, 'restricted', array[reader_id]);
  insert into rs values ('scope saved', (select reader_scope = 'restricted' from public.os_documents where id = doc));
  insert into rs values ('reader saved', exists(select 1 from public.os_document_readers where document_id = doc and user_id = reader_id));
  insert into rs values ('event logged', exists(select 1 from public.os_document_events where document_id = doc and note like '열람 범위%'));

  -- Visibility through RLS for each kind of member.
  for who, n in select * from (values (admin_id, 1), (owner_id, 1), (steward_id, 1), (reader_id, 1), (outsider_id, 0)) v(uid, expected) loop
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into rs values ('document visible=' || n || ' for ' || who, (select count(*) from public.os_documents where id = doc) = n);
    insert into rs values ('version visible=' || n || ' for ' || who, (select count(*) from public.os_document_versions where document_id = doc) = n);
    insert into rs values ('chunk visible=' || n || ' for ' || who, (select count(*) from public.os_document_chunks where document_id = doc) = n);
    insert into rs values ('open canon still visible for ' || owner_id, (select count(*) from public.os_documents where id = open_doc) = 1);
    execute 'reset role';
  end loop;

  -- Back to every member (the API calls the setter with the service role: no signed-in user).
  perform set_config('request.jwt.claims', '{}', true);
  perform public.os_set_document_readers(admin_id, doc, d.current_version, 'all', array[reader_id]);
  insert into rs values ('reopened clears readers', not exists(select 1 from public.os_document_readers where document_id = doc));
  perform set_config('request.jwt.claims', json_build_object('sub', outsider_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into rs values ('reopened visible to outsider', (select count(*) from public.os_documents where id = doc) = 1);
  execute 'reset role';

  raise exception 'RS_RESULT checks=% failures=% | %', (select count(*) from rs), (select count(*) from rs where not ok), (select string_agg(check_name, ' ; ') from rs where not ok);
end $$;
