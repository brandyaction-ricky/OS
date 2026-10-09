-- Synthetic acceptance suite; run only in a disposable database. No production data.
begin;
insert into public.os_profiles(id,email,display_name,role,person_kind,finance_access) values
 ('00000000-0000-4000-8000-000000000001','admin@example.test','QA 관리자','admin','owner',false),
 ('00000000-0000-4000-8000-000000000003','worker@example.test','QA 직원','member','employee',false),
 ('00000000-0000-4000-8000-000000000004','other@example.test','QA 다른 직원','member','employee',false);
-- Exercise the same notification guard used by the existing OS baseline.
create trigger hr_test_notification_guard before insert or update or delete on public.os_records for each row execute function public.os_notification_guard();
grant update on public.os_profiles to authenticated;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
set local role authenticated;
select public.os_hr_upsert_employee('{"profile_id":"00000000-0000-4000-8000-000000000003","person_kind":"employee","display_name":"QA 직원","legal_name":"가상 직원","email":"worker@example.test","hire_date":"2023-04-03","contract":{"contract_type":"permanent","weekly_hours":40}}',0,null);
create temporary table hr_ext_ids as select (public.os_hr_people()->0->>'id')::uuid employee,null::uuid promotion,null::uuid form;
do $$ declare e uuid:=(select employee from hr_ext_ids);r uuid;begin
 r:=public.os_hr_send_promotion(e,'notice_1',16,'{}','os_email','가상 촉진 서면',null);update hr_ext_ids set promotion=r;
 begin perform public.os_hr_send_promotion(e,'notice_1',16,'{}','os_email','가상 촉진 서면',null);raise exception 'duplicate notice';exception when raise_exception then if sqlerrm<>'ALREADY_SENT' then raise;end if;end;
 if jsonb_array_length(public.os_hr_notification_sources(array[r]))<>0 then raise exception 'operator saw another worker letter source';end if;
end $$;
reset role;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';
set local role authenticated;
do $$ declare r uuid:=(select promotion from hr_ext_ids);begin
 begin update public.os_profiles set finance_access=true where id=auth.uid();raise exception 'self HR elevation';exception when insufficient_privilege then null;end;
 begin update public.os_profiles set person_kind='owner' where id=auth.uid();raise exception 'self classification bypass';exception when insufficient_privilege then null;end;
 perform public.os_hr_mark_promotion_read(r);perform public.os_hr_mark_promotion_read(r);
 if (select count(*) from public.os_hr_leave_promotions where id=r and read_at is not null)<>1 then raise exception 'read receipt';end if;
 perform public.os_hr_reply_promotion(r,array['2026-11-03','2026-11-04']::date[]);
 begin perform public.os_hr_reply_promotion(r,array['2026-11-05']::date[]);raise exception 'duplicate reply';exception when raise_exception then if sqlerrm<>'NOT_IN_WINDOW' then raise;end if;end;
 if jsonb_array_length(public.os_hr_notification_sources(array[r]))<>1 then raise exception 'missing own notification';end if;
end $$;
reset role;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ declare e uuid:=(select employee from hr_ext_ids);dates date[];begin
 begin perform public.os_hr_send_promotion(e,'designation_2',14,array['2026-11-05']::date[],'os_email','가상 지정 서면',null);raise exception 'short designation accepted';exception when raise_exception then if sqlerrm<>'DATES_REQUIRED' then raise;end if;end;
 select array_agg(day_key) into dates from (select d::date as day_key from generate_series('2026-11-02'::timestamp,'2026-11-30',interval '1 day') d where extract(isodow from d) between 1 and 5 order by d limit 14) x;
 perform public.os_hr_send_promotion(e,'designation_2',14,dates,'os_email','가상 지정 서면',null);
end $$;
reset role;
insert into storage.objects(bucket_id,name) select 'hr-documents','document/'||employee::text||'/00000000-0000-4000-8000-000000000010.pdf' from hr_ext_ids;
insert into storage.objects(bucket_id,name) values('hr-documents','form/form/00000000-0000-4000-8000-000000000020.pdf'),('hr-documents','form/form/00000000-0000-4000-8000-000000000021.pdf');
set local role authenticated;
do $$ declare e uuid:=(select employee from hr_ext_ids);path text:='document/'||e::text||'/00000000-0000-4000-8000-000000000010.pdf';c uuid;r uuid;begin
 begin perform public.os_hr_set_document(e,'contract_signed','done','2026-10-09','document/00000000-0000-4000-8000-000000000004/00000000-0000-4000-8000-000000000010.pdf',1);raise exception 'foreign file accepted';exception when raise_exception then if sqlerrm<>'INVALID_FILE' then raise;end if;end;
 perform public.os_hr_set_document(e,'contract_signed','done','2026-10-09',path,1);perform public.os_hr_file_view(path);
 select id into c from public.os_hr_contracts where hr_employee_id=e and is_current;
 perform public.os_hr_change_contract(e,'{"contract_type":"part_time","start_date":"2026-10-01","weekly_hours":20}','가상 근로 조건 변경',c);
 begin perform public.os_hr_change_contract(e,'{"contract_type":"permanent","start_date":"2026-10-01","weekly_hours":40}','동시 변경',c);raise exception 'stale contract replaced current';exception when raise_exception then if sqlerrm<>'VERSION_CONFLICT' then raise;end if;end;
 if not exists(select 1 from public.os_hr_events where hr_employee_id=e and action='contract.documents_archived' and detail::text like '%'||path||'%') then raise exception 'prior contract file lost';end if;
 r:=public.os_hr_set_form(null,0,'가상 양식','QA','custom','v1','form/form/00000000-0000-4000-8000-000000000020.pdf');update hr_ext_ids set form=r;
 perform public.os_hr_set_form(r,1,'가상 양식','QA','custom','v2','form/form/00000000-0000-4000-8000-000000000021.pdf');
 if not exists(select 1 from public.os_hr_events where action='form.updated' and detail->>'previousLabel'='v1') then raise exception 'prior form version lost';end if;
end $$;
reset role;
insert into public.os_records(id,record_type,assignee_id,status,metric_current,metadata) values ('00000000-0000-4000-8000-000000000030','leave_balance','00000000-0000-4000-8000-000000000003','active',9,'{}');
insert into public.os_records(id,record_type,assignee_id,status,metric_current,starts_at,ends_at,metadata) values ('00000000-0000-4000-8000-000000000031','leave_request','00000000-0000-4000-8000-000000000003','approved',1,'2026-10-13','2026-10-13','{"leaveType":"연차","days":1}');
set local role authenticated;
do $$ declare e uuid:=(select employee from hr_ext_ids);r jsonb;begin
 r:=public.os_hr_legacy_preview(e);if (r->>'oldBalance')::numeric<>9 then raise exception 'legacy balance preview';end if;
 perform public.os_hr_import_legacy(e,1,'00000000-0000-4000-8000-000000000030',1,'[{"id":"00000000-0000-4000-8000-000000000031","version":1,"type":"annual"}]');
 r:=public.os_hr_legacy_preview(e);if (r->>'newBalance')::numeric<>9 or not (r->>'imported')::boolean then raise exception 'opening imported before request / double deduction';end if;
 begin perform public.os_hr_import_legacy(e,1,'00000000-0000-4000-8000-000000000030',1,'[]');raise exception 'duplicate import';exception when raise_exception then if sqlerrm<>'ALREADY_IMPORTED' then raise;end if;end;
end $$;
reset role;
do $$ begin
 if (select metric_current from public.os_records where id='00000000-0000-4000-8000-000000000030')<>9 or (select status from public.os_records where id='00000000-0000-4000-8000-000000000031')<>'approved' then raise exception 'legacy records modified';end if;
 if not exists(select 1 from public.os_records where record_type='notification' and metadata->>'sourceType'='hr_promotion') then raise exception 'HR notification guard failed';end if;
end $$;
rollback;
select 'HR extended SQL acceptance passed' as result;
