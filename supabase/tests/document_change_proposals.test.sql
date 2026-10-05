-- Run only in approved DEV after both approval/proposal migrations. Fixtures roll back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth;
select plan(9);

insert into auth.users(id, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data) values
('00000000-0000-4000-8000-000000004101','authenticated','proposal-author@example.test','',now(),'{}'),
('00000000-0000-4000-8000-000000004102','authenticated','proposal-reviewer@example.test','',now(),'{}');
update public.os_profiles set is_active = true, must_change_password = false
where id in ('00000000-0000-4000-8000-000000004101','00000000-0000-4000-8000-000000004102');
update public.os_profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000004102';
insert into public.os_documents(id,title,content_md,status,owner_id) values
('00000000-0000-4000-8000-000000004103','Published','Original','canonical','00000000-0000-4000-8000-000000004101');
insert into public.os_document_proposals(id,document_id,base_version,title,content_md,author_id) values
('00000000-0000-4000-8000-000000004104','00000000-0000-4000-8000-000000004103',1,'Updated','Proposed','00000000-0000-4000-8000-000000004101'),
('00000000-0000-4000-8000-000000004105','00000000-0000-4000-8000-000000004103',1,'Stale','Stale body','00000000-0000-4000-8000-000000004101');

select is((select content_md from public.os_documents where id = '00000000-0000-4000-8000-000000004103'),'Original','proposal does not change published content');
select is((select current_version from public.os_documents where id = '00000000-0000-4000-8000-000000004103'),1,'proposal does not create a document version');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004101',true);
select throws_ok($$select public.os_apply_document_proposal('00000000-0000-4000-8000-000000004104','self')$$,
  '42501','OS_PROPOSAL_APPROVAL_DENIED','author cannot approve own proposal');
select throws_ok($$update public.os_documents set content_md = 'Direct edit' where id = '00000000-0000-4000-8000-000000004103'$$,
  '42501','OS_CANONICAL_PROPOSAL_REQUIRED','legacy authenticated direct edit is denied');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004102',true);
select lives_ok($$select public.os_apply_document_proposal('00000000-0000-4000-8000-000000004104','reviewed')$$,
  'another active admin can approve proposal');
reset role;
select is((select content_md from public.os_documents where id = '00000000-0000-4000-8000-000000004103'),'Proposed','approval updates published content');
select is((select current_version from public.os_documents where id = '00000000-0000-4000-8000-000000004103'),2,'approval creates exactly one new version');
select is((select status from public.os_document_proposals where id = '00000000-0000-4000-8000-000000004104'),'approved','approved proposal records its decision');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004102',true);
select throws_ok($$select public.os_apply_document_proposal('00000000-0000-4000-8000-000000004105','stale')$$,
  '40001','OS_PROPOSAL_VERSION_CONFLICT:2','stale base version cannot overwrite current canonical');
reset role;
select * from finish();
rollback;
