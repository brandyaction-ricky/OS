-- Run in approved DEV after the forward migration; no production fixtures.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,auth;
select plan(10);
insert into auth.users(id,role,email,encrypted_password,email_confirmed_at,raw_user_meta_data) values
('00000000-0000-4000-8000-000000002001','authenticated','notify-actor@example.test','',now(),'{}'),
('00000000-0000-4000-8000-000000002002','authenticated','notify-recipient@example.test','',now(),'{}');
update public.os_profiles set is_active=true,must_change_password=false where id in ('00000000-0000-4000-8000-000000002001','00000000-0000-4000-8000-000000002002');
insert into public.os_records(id,record_type,title,status,assignee_id,created_by,updated_by) values
('00000000-0000-4000-8000-000000002003','task','Assignment fixture','planned','00000000-0000-4000-8000-000000002002','00000000-0000-4000-8000-000000002001','00000000-0000-4000-8000-000000002001');
select is((select count(*) from public.os_records where record_type='notification' and metadata->>'sourceId'='00000000-0000-4000-8000-000000002003'),1::bigint,'assignment creates one recipient notification');
select is((select count(*) from public.os_record_events e join public.os_records r on r.id=e.record_id where r.record_type='notification' and r.metadata->>'sourceId'='00000000-0000-4000-8000-000000002003'),0::bigint,'recipient metadata is absent from shared event snapshots');
update public.os_records set description='ordinary edit' where id='00000000-0000-4000-8000-000000002003';
select is((select count(*) from public.os_records where record_type='notification' and metadata->>'sourceId'='00000000-0000-4000-8000-000000002003'),1::bigint,'ordinary edits do not re-notify');
select public.os_enqueue_work_notification('00000000-0000-4000-8000-000000002002','00000000-0000-4000-8000-000000002001','record','00000000-0000-4000-8000-000000002003','assignment','1');
select is((select count(*) from public.os_records where record_type='notification' and metadata->>'sourceId'='00000000-0000-4000-8000-000000002003'),1::bigint,'same event key is idempotent');
select public.os_enqueue_work_notification('00000000-0000-4000-8000-000000002001','00000000-0000-4000-8000-000000002001','record','00000000-0000-4000-8000-000000002003','assignment','2');
select is((select count(*) from public.os_records where record_type='notification' and owner_id='00000000-0000-4000-8000-000000002001'),0::bigint,'self-actions never notify the actor');
select throws_ok($$update public.os_records set title='leaked source title' where record_type='notification' and metadata->>'sourceId'='00000000-0000-4000-8000-000000002003'$$,'23514','NOTIFICATION_IMMUTABLE','payload cannot be repurposed');
select ok(not has_function_privilege('authenticated','public.os_enqueue_work_notification(uuid,uuid,text,uuid,text,text)','execute'),'members cannot forge notifications through RPC');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000002002',true);
select is((select count(*) from public.os_records where record_type='notification'),0::bigint,'recipient uses source-checked API, not raw notification metadata');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000002001',true);
select is((select count(*) from public.os_records where record_type='notification'),0::bigint,'other members cannot read notifications directly');
reset role;
update public.os_profiles set role='admin' where id='00000000-0000-4000-8000-000000002001';
set local role authenticated;
select is((select count(*) from public.os_records where record_type='notification'),0::bigint,'restrictive notification rule also applies to authenticated admins');
select * from finish();
rollback;
