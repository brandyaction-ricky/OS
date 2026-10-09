-- Isolated disposable database only. All fixtures are synthetic; transaction rolls back.
begin;
insert into public.os_profiles(id,email,display_name,role,finance_access,person_kind) values
 ('00000000-0000-4000-8000-000000000001','admin@example.test','QA 관리자','admin',false,'owner'),
 ('00000000-0000-4000-8000-000000000002','hr@example.test','QA 인사','member',true,'employee'),
 ('00000000-0000-4000-8000-000000000003','worker@example.test','QA 근로자','member',false,'employee'),
 ('00000000-0000-4000-8000-000000000004','other@example.test','QA 다른 구성원','member',false,'employee');
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
set local role authenticated;
select public.os_hr_upsert_employee('{"profile_id":"00000000-0000-4000-8000-000000000003","person_kind":"employee","display_name":"QA 근로자","legal_name":"가상 직원","email":"worker@example.test","hire_date":"2023-03-02","contract":{"contract_type":"permanent","weekly_hours":40}}',0,null);
create temporary table hr_test_ids as select (public.os_hr_people()->0->>'id')::uuid employee;
do $$ declare e uuid:=(select employee from hr_test_ids);b jsonb;r uuid;n int;v int;begin
 b:=public.os_hr_people();if b->0->>'legal_name'='가상 직원' then raise exception 'unmasked employee';end if;
 if (select count(*) from public.os_hr_documents where hr_employee_id=e)<>6 then raise exception 'document defaults';end if;
 if (public.os_hr_reveal(e,array['legal_name'])->>'legal_name')<>'가상 직원' then raise exception 'reveal mismatch';end if;
 begin perform legal_name from public.os_hr_employees where id=e;raise exception 'raw sensitive read allowed';exception when insufficient_privilege then null;end;
 begin insert into public.os_hr_events(action) values('tamper');raise exception 'direct write allowed';exception when insufficient_privilege then null;end;
 begin perform public.os_hr_add_credit(e,1,'','adjustment');raise exception 'reason missing accepted';exception when raise_exception then if sqlerrm<>'REASON_REQUIRED' then raise;end if;end;
 begin perform public.os_hr_add_credit(e,.3,'test','adjustment');raise exception 'fraction accepted';exception when raise_exception then if sqlerrm<>'INVALID_DAYS' then raise;end if;end;
 r:=public.os_hr_request_leave(e,'annual','2026-12-23','2026-12-28','test',null,false);
 if (select days from public.os_hr_leave_requests where id=r)<>4 then raise exception 'workdays mismatch before holiday';end if;
 perform public.os_hr_set_holiday('2026-12-25','QA 휴일');
 perform public.os_hr_decide_leave(r,1,'approved',null);
 if (select days from public.os_hr_leave_requests where id=r)<>3 then raise exception 'approval did not recalculate';end if;
 perform public.os_hr_set_holiday('2026-12-24','QA 추가 휴일');
 if (select days from public.os_hr_leave_requests where id=r)<>3 then raise exception 'approved snapshot changed';end if;
 begin perform public.os_hr_decide_leave(r,1,'approved',null);raise exception 'stale version accepted';exception when raise_exception then if sqlerrm<>'VERSION_CONFLICT' then raise;end if;end;
 begin perform public.os_hr_request_leave(e,'annual','2026-12-23','2026-12-28',null,null,true);raise exception 'overlap accepted';exception when raise_exception then if sqlerrm<>'OVERLAP_SELF' then raise;end if;end;
 perform public.os_hr_cancel_leave(r,2);
 if (select status from public.os_hr_leave_requests where id=r)<>'cancelled' then raise exception 'cancel failed';end if;
 r:=public.os_hr_request_leave(e,'half_am','2026-12-29','2026-12-29',null,null,false);
 if (select days from public.os_hr_leave_requests where id=r)<>.5 then raise exception 'half day mismatch';end if;
 begin perform public.os_hr_decide_leave(r,1,'rejected','');raise exception 'rejection reason missing accepted';exception when raise_exception then if sqlerrm<>'REASON_REQUIRED' then raise;end if;end;
 perform public.os_hr_decide_leave(r,1,'rejected','가상 반려');
 select count(*) into n from public.os_hr_contracts where hr_employee_id=e;
 begin perform public.os_hr_change_contract(e,'{"contract_type":"fixed_term","start_date":"2026-10-01","weekly_hours":40}','계약 테스트',(select id from public.os_hr_contracts where hr_employee_id=e and is_current));raise exception 'missing fixed end accepted';exception when check_violation then null;end;
 if (select count(*) from public.os_hr_contracts where hr_employee_id=e)<>n or not exists(select 1 from public.os_hr_contracts where hr_employee_id=e and is_current) then raise exception 'contract rollback failed';end if;
 perform public.os_hr_change_contract(e,'{"contract_type":"fixed_term","start_date":"2026-10-01","end_date":"2027-09-30","weekly_hours":40}','가상 변경',(select id from public.os_hr_contracts where hr_employee_id=e and is_current));
 if (select count(*) from public.os_hr_contracts where hr_employee_id=e and is_current)<>1 then raise exception 'current contract uniqueness';end if;
end $$;
reset role;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';
set local role authenticated;
do $$ declare e uuid:=public.os_hr_my_employee_id();r uuid;begin
 if e is null then raise exception 'self employee missing';end if;
 begin perform public.os_hr_people();raise exception 'worker saw HR';exception when insufficient_privilege then null;end;
 if (select count(*) from public.os_hr_documents)>0 then raise exception 'worker saw documents';end if;
 r:=public.os_hr_request_leave(e,'annual','2026-12-30','2026-12-30',null,null,true);
 if (select status from public.os_hr_leave_requests where id=r)<>'pending' then raise exception 'self direct approved';end if;
 begin perform public.os_hr_decide_leave(r,1,'approved',null);raise exception 'self approve allowed';exception when insufficient_privilege then null;end;
 perform public.os_hr_cancel_leave(r,1);
end $$;
reset role;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000004';
set local role authenticated;
do $$ begin if (select count(*) from public.os_hr_leave_requests)>0 then raise exception 'cross-person request leak';end if;end $$;
reset role;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
set local role authenticated;
do $$ begin
 if not public.os_has_hr_access() then raise exception 'HR operator denied';end if;
 begin perform public.os_hr_set_account('00000000-0000-4000-8000-000000000003','{"role":"admin"}',now());raise exception 'nonadmin privilege change';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local request.jwt.claim.sub='';
set local request.jwt.claims='{"role":"service_role"}';
set local role service_role;
select public.os_hr_cron_run();
select public.os_hr_cron_run();
reset role;
do $$ declare e uuid:=(select employee from hr_test_ids);begin
 if exists(select hr_employee_id,kind,entry_date from public.os_hr_leave_credits group by 1,2,3 having count(*)>1) then raise exception 'duplicate accrual';end if;
 if exists(select metadata->>'dedupeKey' from public.os_records where record_type='notification' group by 1 having count(*)>1) then raise exception 'duplicate notification';end if;
 begin update public.os_hr_leave_credits set days=1 where hr_employee_id=e;raise exception 'ledger mutable';exception when raise_exception then if sqlerrm<>'HR_IMMUTABLE' then raise;end if;end;
 if (select start_date from os_hr_private.period('2024-02-29','2027-10-09'))<>'2027-02-28' or (select end_date from os_hr_private.period('2024-02-29','2027-10-09'))<>'2028-02-28' then raise exception 'SQL leap period mismatch';end if;
 if (select min(entry_date) from os_hr_private.accruals('2025-01-31','2026-01-31'))<>'2025-02-28' then raise exception 'SQL month end mismatch';end if;
end $$;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
set local role authenticated;
select public.os_hr_retire((select employee from hr_test_ids),1,((now() at time zone 'Asia/Seoul')::date-1),'voluntary','{"handoff":true}');
reset role;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';
set local role authenticated;
do $$ begin if public.os_hr_session_active() then raise exception 'retired JWT accepted';end if;if (select count(*) from public.os_hr_leave_requests)>0 then raise exception 'retired RLS reads allowed';end if;end $$;
reset role;
rollback;
select 'HR SQL acceptance passed' as result;
