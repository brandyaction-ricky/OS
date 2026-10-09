-- Candidate integration test. NOT executed automatically by npm test.
-- Requires separately approved, disposable Local/DEV database with all migrations.
-- Synthetic users only; transaction rolls every fixture back. Never run in Production.
begin;
set local statement_timeout = '20s';
set local lock_timeout = '3s';

insert into auth.users (id, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data) values
 ('96000000-0000-4000-8000-000000000001','authenticated','knowledge-a@example.invalid','',now(),'{}'),
 ('96000000-0000-4000-8000-000000000002','authenticated','knowledge-b@example.invalid','',now(),'{}'),
 ('96000000-0000-4000-8000-000000000003','authenticated','knowledge-admin@example.invalid','',now(),'{}'),
 ('96000000-0000-4000-8000-000000000004','authenticated','knowledge-partner@example.invalid','',now(),'{}');
update public.os_profiles set is_active=true,role='member',member_kind='staff'
 where id between '96000000-0000-4000-8000-000000000001' and '96000000-0000-4000-8000-000000000004';
update public.os_profiles set role='admin' where id='96000000-0000-4000-8000-000000000003';
update public.os_profiles set member_kind='partner' where id='96000000-0000-4000-8000-000000000004';
insert into public.os_doc_categories(id,space,name,partner_ids,created_by) values
 ('97000000-0000-4000-8000-000000000001','team','QA shared category',array['96000000-0000-4000-8000-000000000004'::uuid],'96000000-0000-4000-8000-000000000001'),
 ('97000000-0000-4000-8000-000000000002','team','QA restricted','{}','96000000-0000-4000-8000-000000000001');
insert into public.os_documents(id,title,content_md,status,owner_id,category_id,steward_id) values
 ('98000000-0000-4000-8000-000000000001','QA private A','private','draft','96000000-0000-4000-8000-000000000001',null,null),
 ('98000000-0000-4000-8000-000000000002','QA shared','team','team','96000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000001',null),
 ('98000000-0000-4000-8000-000000000003','QA restricted','team','team','96000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000002',null),
 ('98000000-0000-4000-8000-000000000004','QA canonical','canon','canonical','96000000-0000-4000-8000-000000000001',null,'96000000-0000-4000-8000-000000000004'),
 ('98000000-0000-4000-8000-000000000005','QA partner own','team','team','96000000-0000-4000-8000-000000000004',null,null);

set local role authenticated;
select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000002',true);
do $$ begin
 if exists(select 1 from public.os_documents where id='98000000-0000-4000-8000-000000000001') then raise exception 'QA private document leaked to member'; end if;
 if exists(select 1 from public.os_document_versions where document_id='98000000-0000-4000-8000-000000000001') then raise exception 'QA private version leaked'; end if;
 perform public.os_knowledge_command(jsonb_build_object('action','document.commit','id','98000000-0000-4000-8000-000000000002','expectedVersion',(select current_version from public.os_documents where id='98000000-0000-4000-8000-000000000002'),'title','QA shared','content','member B edit'));
 begin
  update public.os_documents set folder='forbidden' where id='98000000-0000-4000-8000-000000000004';
  raise exception 'QA canonical metadata update allowed';
 exception when insufficient_privilege then null; end;
 begin
  update public.os_doc_categories set partner_ids='{}' where id='97000000-0000-4000-8000-000000000001';
  raise exception 'QA member changed partner access';
 exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000004',true);
do $$ begin
 if exists(select 1 from public.os_documents where id='98000000-0000-4000-8000-000000000003') then raise exception 'QA restricted category leaked'; end if;
 if (select count(*) from public.os_documents where id in ('98000000-0000-4000-8000-000000000002','98000000-0000-4000-8000-000000000004','98000000-0000-4000-8000-000000000005'))<>3 then raise exception 'QA partner readable set differs'; end if;
 begin
  perform public.os_knowledge_command(jsonb_build_object('action','document.properties','id','98000000-0000-4000-8000-000000000002','expectedVersion',(select current_version from public.os_documents where id='98000000-0000-4000-8000-000000000002'),'categoryId',null));
  raise exception 'QA partner changed category';
 exception when insufficient_privilege then null; end;
 perform public.os_keep_canon_review('98000000-0000-4000-8000-000000000004',(select current_version from public.os_documents where id='98000000-0000-4000-8000-000000000004'));
 if (select review_due_on from public.os_documents where id='98000000-0000-4000-8000-000000000004')<>(now() at time zone 'Asia/Seoul')::date+90 then raise exception 'QA partner steward cannot renew review'; end if;
end $$;

select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000003',true);
do $$ begin
 if exists(select 1 from public.os_documents where id='98000000-0000-4000-8000-000000000001') then raise exception 'QA private document leaked to admin'; end if;
 perform public.os_knowledge_command(jsonb_build_object('action','note.access','id','98000000-0000-4000-8000-000000000001','reason','QA explicit temporary audit'));
 if not exists(select 1 from public.os_documents where id='98000000-0000-4000-8000-000000000001') then raise exception 'QA temporary access missing'; end if;
 begin
  perform public.os_knowledge_command(jsonb_build_object('action','document.commit','id','98000000-0000-4000-8000-000000000001','expectedVersion',(select current_version from public.os_documents where id='98000000-0000-4000-8000-000000000001'),'content','forbidden'));
  raise exception 'QA temporary grant permitted writing';
 exception when insufficient_privilege then null; end;
 begin
  perform public.os_knowledge_command(jsonb_build_object('action','trash.purge','id','98000000-0000-4000-8000-000000000004','reason','QA','confirm',true));
  raise exception 'QA canonical permanent deletion permitted';
 exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000001',true);
do $$ declare first_id uuid; second_id uuid; meeting_id uuid; begin
 begin
  perform public.os_set_document_status('98000000-0000-4000-8000-000000000001','canonical','invalid shortcut');
  raise exception 'QA draft promoted without review';
 exception when insufficient_privilege then null; end;
 first_id:=(public.os_knowledge_command(jsonb_build_object('action','document.create','space','mine','title','QA daily','dailyOn','2026-10-09'))->>'id')::uuid;
 second_id:=(public.os_knowledge_command(jsonb_build_object('action','document.create','space','mine','title','QA daily duplicate','dailyOn','2026-10-09'))->>'id')::uuid;
 if first_id is null or first_id<>second_id then raise exception 'QA daily creation not idempotent'; end if;
 meeting_id:=(public.os_knowledge_command(jsonb_build_object('action','meeting.create','title','QA private meeting','visibility','attendees'))->>'id')::uuid;
 perform set_config('qa.knowledge_meeting_id',meeting_id::text,true);
 begin
  insert into public.os_doc_categories(space,name,created_by) values('team','QA shared category',auth.uid());
  raise exception 'QA duplicate category allowed';
 exception when unique_violation then null; end;
end $$;
select set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000003',true);
do $$ begin
 if exists(select 1 from public.os_records where id=current_setting('qa.knowledge_meeting_id')::uuid or parent_id=current_setting('qa.knowledge_meeting_id')::uuid) then raise exception 'QA private meeting/children leaked to admin'; end if;
 if exists(select 1 from public.os_documents where meeting_record_id=current_setting('qa.knowledge_meeting_id')::uuid) then raise exception 'QA private meeting document leaked'; end if;
 if has_function_privilege('authenticated','public.os_workspace_purge_expired()','EXECUTE') or has_function_privilege('anon','public.os_knowledge_command(jsonb)','EXECUTE') then raise exception 'QA overbroad execution grants'; end if;
end $$;
reset role;
rollback;
select 'knowledge workspace RLS integration passed; synthetic fixtures rolled back' as result;
