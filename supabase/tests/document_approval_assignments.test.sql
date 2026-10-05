-- Run only in approved DEV after the additive migration. All fixture writes roll back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth;
select plan(16);

insert into auth.users(id, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data) values
('00000000-0000-4000-8000-000000003001','authenticated','approval-author@example.test','',now(),'{}'),
('00000000-0000-4000-8000-000000003002','authenticated','approval-admin@example.test','',now(),'{}'),
('00000000-0000-4000-8000-000000003003','authenticated','approval-delegate@example.test','',now(),'{}');
update public.os_profiles set is_active = true, must_change_password = false
where id in ('00000000-0000-4000-8000-000000003001','00000000-0000-4000-8000-000000003002','00000000-0000-4000-8000-000000003003');
update public.os_profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000003002';
insert into public.os_documents(id,title,content_md,status,owner_id) values
('00000000-0000-4000-8000-000000003004','Approval fixture','unchanged','review','00000000-0000-4000-8000-000000003001'),
('00000000-0000-4000-8000-000000003008','Delegation fixture','unchanged','review','00000000-0000-4000-8000-000000003001');
insert into public.os_records(id,record_type,title,status,owner_id,created_by,metadata) values
('00000000-0000-4000-8000-000000003007','content_package','Appeal fixture','review',
 '00000000-0000-4000-8000-000000003001','00000000-0000-4000-8000-000000003001',
 '{"packageKind":"appeal_candidates","candidateSetVersion":"v1","result":{"candidates":[{"text":"A"}]}}'::jsonb);

select is(public.os_can_approve('00000000-0000-4000-8000-000000003001','00000000-0000-4000-8000-000000003001'),false,'author cannot approve own document');
select is(public.os_can_approve('00000000-0000-4000-8000-000000003002','00000000-0000-4000-8000-000000003001'),true,'admin is fallback when approver list is empty');
select is(public.os_can_approve('00000000-0000-4000-8000-000000003002','00000000-0000-4000-8000-000000003002'),false,'admin cannot approve own document');

insert into public.os_approval_assignments(id,user_id,kind,created_by) values
('00000000-0000-4000-8000-000000003005','00000000-0000-4000-8000-000000003002','approver','00000000-0000-4000-8000-000000003002');
select is(public.os_can_approve('00000000-0000-4000-8000-000000003002','00000000-0000-4000-8000-000000003001'),true,'named approver can approve someone else');

insert into public.os_approval_assignments(id,user_id,kind,delegated_by,starts_on,ends_on,created_by) values
('00000000-0000-4000-8000-000000003006','00000000-0000-4000-8000-000000003003','delegate','00000000-0000-4000-8000-000000003002',current_date,current_date + 1,'00000000-0000-4000-8000-000000003002');
select is(public.os_can_approve('00000000-0000-4000-8000-000000003003','00000000-0000-4000-8000-000000003001'),true,'dated delegate can approve someone else');
select is(public.os_can_approve('00000000-0000-4000-8000-000000003003','00000000-0000-4000-8000-000000003003'),false,'delegate cannot approve own document');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000003003',true);
select lives_ok($$select public.os_set_document_status('00000000-0000-4000-8000-000000003008','reviewed','checked')$$,
  'in-period delegate can review another author document');
reset role;
select like((select note from public.os_document_events where document_id = '00000000-0000-4000-8000-000000003008' and to_status = 'reviewed'),
  '%위임 승인%', 'delegated approval records its delegation in event note');
update public.os_approval_assignments set starts_on = current_date - 2, ends_on = current_date - 1
where id = '00000000-0000-4000-8000-000000003006';
select is(public.os_can_approve('00000000-0000-4000-8000-000000003003','00000000-0000-4000-8000-000000003001'),false,'expired delegation cannot approve');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000003001',true);
select throws_ok($$select public.os_set_document_status('00000000-0000-4000-8000-000000003004','reviewed','self')$$,
  'P0001','OS_STATUS_TRANSITION_DENIED: review -> reviewed','author status transition fails at database boundary');
select throws_ok($$select public.os_decide_appeals('00000000-0000-4000-8000-000000003007',1,'v1','[{"index":0,"decision":"approved"}]'::jsonb)$$,
  '42501','OS_APPEAL_APPROVAL_DENIED','author cannot approve own appeal package');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000003002',true);
select lives_ok($$select public.os_set_document_status('00000000-0000-4000-8000-000000003004','reviewed','approved')$$,
  'named approver can mark another author document reviewed');
select lives_ok($$select public.os_decide_appeals('00000000-0000-4000-8000-000000003007',1,'v1','[{"index":0,"decision":"approved","note":"checked"}]'::jsonb)$$,
  'named approver can decide an appeal package');
reset role;
select is((select count(*) from public.os_document_events where document_id = '00000000-0000-4000-8000-000000003004' and to_status = 'reviewed'),1::bigint,'approved transition is recorded once');
select is((select jsonb_array_length(metadata->'decisionHistory') from public.os_records where id = '00000000-0000-4000-8000-000000003007'),1,'appeal decision history is append-only');
select throws_ok($$update public.os_records set metadata = jsonb_set(metadata,'{result,candidates,0,decision}','"held"'::jsonb)
  where id = '00000000-0000-4000-8000-000000003007'$$,
  '42501','OS_APPEAL_DECISION_API_REQUIRED','generic writes cannot change appeal decisions');
select * from finish();
rollback;
