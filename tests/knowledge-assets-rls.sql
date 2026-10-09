-- Run only against an explicitly confirmed Local/DEV database.
-- No Storage objects or real users are used; every fixture is rolled back.
begin;
set local statement_timeout = '15s';
set local lock_timeout = '5s';

insert into auth.users (id, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data) values
  ('91000000-0000-4000-8000-000000000001', 'authenticated', 'asset-owner@example.invalid', '', now(), '{}'),
  ('91000000-0000-4000-8000-000000000002', 'authenticated', 'asset-peer@example.invalid', '', now(), '{}');
update public.os_profiles set role = 'member', team = 'asset-alpha', is_active = true
where id = '91000000-0000-4000-8000-000000000001';
update public.os_profiles set role = 'member', team = 'asset-beta', is_active = true
where id = '91000000-0000-4000-8000-000000000002';

insert into public.os_documents (id, title, content_md, status, owner_id, team) values
  ('92000000-0000-4000-8000-000000000001', 'Asset QA own draft', '![[fixture.png]]', 'draft', '91000000-0000-4000-8000-000000000001', 'asset-alpha'),
  ('92000000-0000-4000-8000-000000000002', 'Asset QA peer draft', '![[fixture.png]]', 'draft', '91000000-0000-4000-8000-000000000002', 'asset-beta'),
  ('92000000-0000-4000-8000-000000000003', 'Asset QA team', '![[fixture.png]]', 'team', '91000000-0000-4000-8000-000000000001', 'asset-alpha'),
  ('92000000-0000-4000-8000-000000000004', 'Asset QA canonical', '![[fixture.png]]', 'canonical', '91000000-0000-4000-8000-000000000001', 'asset-alpha');

insert into public.os_knowledge_attachment_uploads (path, encoded_path, document_id, uploader_id)
select path, replace(path, '/', '%2F'), id, owner_id from (
  select id, owner_id, 'documents/' || id || '/' || owner_id || '/2026-10-01/' || id || '.png' as path
  from public.os_documents where id between '92000000-0000-4000-8000-000000000001' and '92000000-0000-4000-8000-000000000004'
) fixture;

set local role service_role;
insert into public.os_knowledge_assets (document_id, reference, reference_key, file_name, file_size, mime_type, storage_path, sha256)
select document_id, 'fixture.png', 'fixture.png', 'fixture.png', 100, 'image/png', path, repeat('a', 64)
from public.os_knowledge_attachment_uploads
where document_id between '92000000-0000-4000-8000-000000000001' and '92000000-0000-4000-8000-000000000004';
reset role;

do $$ begin
  if (select count(*) from public.os_knowledge_attachment_uploads
      where document_id between '92000000-0000-4000-8000-000000000001' and '92000000-0000-4000-8000-000000000004'
      and status = 'referenced' and referenced_at is not null) <> 4 then
    raise exception 'QA: pending uploads were not atomically adopted';
  end if;
  if exists (select 1 from public.os_documents
      where id between '92000000-0000-4000-8000-000000000001' and '92000000-0000-4000-8000-000000000004'
      and content_md <> '![[fixture.png]]') then
    raise exception 'QA: original document content changed';
  end if;
  if has_table_privilege('anon', 'public.os_knowledge_assets', 'SELECT')
     or has_table_privilege('authenticated', 'public.os_knowledge_assets', 'INSERT,UPDATE,DELETE')
     or has_function_privilege('authenticated', 'public.os_mark_knowledge_asset_attachment_referenced()', 'EXECUTE') then
    raise exception 'QA: excessive public privileges';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
do $$ begin
  if (select count(*) from public.os_knowledge_assets
      where document_id between '92000000-0000-4000-8000-000000000001' and '92000000-0000-4000-8000-000000000004') <> 3 then
    raise exception 'QA: owner must see own draft, team and canonical assets only';
  end if;
  if exists (select 1 from public.os_knowledge_assets where document_id = '92000000-0000-4000-8000-000000000002') then
    raise exception 'QA: peer draft asset leaked';
  end if;
end $$;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
do $$ begin
  if (select count(*) from public.os_knowledge_assets
      where document_id between '92000000-0000-4000-8000-000000000001' and '92000000-0000-4000-8000-000000000004') <> 3
     or not exists (select 1 from public.os_knowledge_assets where document_id = '92000000-0000-4000-8000-000000000003') then
    raise exception 'QA: cross-team shared document visibility is not inherited';
  end if;
  if exists (select 1 from public.os_knowledge_assets where document_id = '92000000-0000-4000-8000-000000000001') then
    raise exception 'QA: another owner draft asset leaked';
  end if;
  begin
    update public.os_knowledge_assets set file_name = 'forbidden.png';
    raise exception 'QA: authenticated direct update was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role anon;
do $$ begin
  begin
    perform 1 from public.os_knowledge_assets;
    raise exception 'QA: anonymous metadata access was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

do $$ declare
  fixture public.os_knowledge_assets;
  expired_path text;
begin
  select * into strict fixture from public.os_knowledge_assets
  where document_id = '92000000-0000-4000-8000-000000000001';
  begin
    insert into public.os_knowledge_assets (document_id, reference, reference_key, file_name, file_size, mime_type, storage_path)
    values (fixture.document_id, 'same.png', fixture.reference_key, 'same.png', 100, 'image/png', fixture.storage_path);
    raise exception 'QA: duplicate document reference was allowed';
  exception when unique_violation then null;
  end;
  begin
    update public.os_knowledge_assets set file_size = 104857601 where id = fixture.id;
    raise exception 'QA: oversized metadata was allowed';
  exception when check_violation then null;
  end;
  begin
    update public.os_knowledge_assets set mime_type = 'text/html' where id = fixture.id;
    raise exception 'QA: non-image MIME type was allowed';
  exception when check_violation then null;
  end;
  begin
    update public.os_knowledge_assets set sha256 = 'not-a-checksum' where id = fixture.id;
    raise exception 'QA: invalid checksum was allowed';
  exception when check_violation then null;
  end;
  begin
    update public.os_knowledge_assets set document_id = '92000000-0000-4000-8000-000000000002', reference_key = 'wrong-document.png' where id = fixture.id;
    raise exception 'QA: cross-document storage path was allowed';
  exception when check_violation then null;
  end;
  expired_path := replace(fixture.storage_path, '/2026-10-01/', '/2026-09-01/');
  insert into public.os_knowledge_attachment_uploads (path, encoded_path, document_id, uploader_id, status)
  values (expired_path, replace(expired_path, '/', '%2F'), fixture.document_id, '91000000-0000-4000-8000-000000000001', 'deleting');
  begin
    update public.os_knowledge_assets set storage_path = expired_path where id = fixture.id;
    raise exception 'QA: cleanup-claimed upload was adopted';
  exception when raise_exception then
    if sqlerrm <> 'OS_ATTACHMENT_EXPIRED' then raise; end if;
  end;
  begin
    update public.os_knowledge_assets set storage_path = replace(expired_path, '/2026-09-01/', '/2026-08-01/') where id = fixture.id;
    raise exception 'QA: absent lifecycle record was adopted';
  exception when raise_exception then
    if sqlerrm <> 'OS_ATTACHMENT_EXPIRED' then raise; end if;
  end;
  update public.os_knowledge_assets set file_name = 'renamed.png', updated_at = '2000-01-01' where id = fixture.id;
  if (select updated_at from public.os_knowledge_assets where id = fixture.id) < transaction_timestamp() then
    raise exception 'QA: updated_at trigger did not run';
  end if;
  begin
    delete from public.os_documents where id = fixture.document_id;
    raise exception 'QA: unguarded document purge was allowed';
  exception when insufficient_privilege then null;
  end;
  -- Exercise the FK cascade as the fixture owner only, after checking the guard.
  perform set_config('os.workspace_purge_ok', '1', true);
  delete from public.os_documents where id = fixture.document_id;
  perform set_config('os.workspace_purge_ok', '', true);
  if exists (select 1 from public.os_knowledge_assets where id = fixture.id) then
    raise exception 'QA: deleted document left an orphan mapping';
  end if;
end $$;

rollback;
select 'knowledge asset database checks passed; all fixtures rolled back' as result;
