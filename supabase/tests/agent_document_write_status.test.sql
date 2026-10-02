-- Run only in approved DEV after the forward migration. All fixtures are rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth;
select plan(8);
insert into auth.users(id,role,email,encrypted_password,email_confirmed_at,raw_user_meta_data)
values ('00000000-0000-4000-8000-000000001901','authenticated','write-policy@example.test','',now(),'{}');
update public.os_profiles set is_active=true,must_change_password=false where id='00000000-0000-4000-8000-000000001901';
insert into public.os_organizations(id,slug,name) values ('00000000-0000-4000-8000-000000001902','write-policy-fixture','Write policy fixture');
insert into public.os_agent_keys(id,name,key_hash,key_prefix,scopes,allowed_statuses,created_by,organization_id,owner_user_id,expires_at,enforce_write_statuses)
values ('00000000-0000-4000-8000-000000001903','Draft fixture',repeat('a',64),'fixture',array['knowledge.read','knowledge.write'],array['draft','team','review','reviewed']::public.os_doc_status[],
'00000000-0000-4000-8000-000000001901','00000000-0000-4000-8000-000000001902','00000000-0000-4000-8000-000000001901',now()+interval '1 day',true);
insert into public.os_documents(id,title,content_md,status,owner_id)
values ('00000000-0000-4000-8000-000000001904','Canonical fixture','unchanged','canonical','00000000-0000-4000-8000-000000001901');
select throws_ok($$select public.os_agent_update_document('00000000-0000-4000-8000-000000001903','00000000-0000-4000-8000-000000001902','00000000-0000-4000-8000-000000001904',1,'changed','changed','','','',array[]::text[],array['title'],'fixture')$$,'P0001','OS_AGENT_DOCUMENT_DENIED','draft key cannot update own canonical');
select throws_ok($$select public.os_agent_archive_document('00000000-0000-4000-8000-000000001903','00000000-0000-4000-8000-000000001902','00000000-0000-4000-8000-000000001904','fixture')$$,'P0001','OS_AGENT_DOCUMENT_DENIED','draft key cannot archive own canonical');
select is((select content_md from public.os_documents where id='00000000-0000-4000-8000-000000001904'),'unchanged','denied writes preserve canonical');
select lives_ok($$select public.os_agent_create_document('00000000-0000-4000-8000-000000001903','00000000-0000-4000-8000-000000001902','Draft fixture','draft')$$,'draft key can create draft');
update public.os_agent_keys set allowed_statuses=array['draft','team','review','reviewed','canonical']::public.os_doc_status[] where id='00000000-0000-4000-8000-000000001903';
select lives_ok($$select public.os_agent_update_document('00000000-0000-4000-8000-000000001903','00000000-0000-4000-8000-000000001902','00000000-0000-4000-8000-000000001904',1,'changed','changed','','','',array[]::text[],array['title'],'fixture')$$,'canonical write key can update canonical');
update public.os_agent_keys set enforce_write_statuses=false,allowed_statuses=array['draft']::public.os_doc_status[] where id='00000000-0000-4000-8000-000000001903';
select lives_ok($$select public.os_agent_archive_document('00000000-0000-4000-8000-000000001903','00000000-0000-4000-8000-000000001902','00000000-0000-4000-8000-000000001904','fixture')$$,'legacy key retains pre-migration canonical write permission');
select ok(not has_function_privilege('authenticated','public.os_agent_archive_document(uuid,uuid,uuid,text)','execute'),'no direct authenticated agent write RPC');
select ok(not has_function_privilege('anon','public.os_agent_update_document(uuid,uuid,uuid,integer,text,text,text,text,text,text[],text[],text)','execute'),'no anonymous agent write RPC');
select * from finish();
rollback;
