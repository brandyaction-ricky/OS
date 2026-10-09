-- Additive HR workspace. Review-only: applying to a shared environment needs approval.
-- No employee data, holiday calendar or legacy import is installed automatically.
create schema if not exists os_hr_private;
revoke all on schema os_hr_private from public, anon, authenticated;
alter table public.os_profiles add column person_kind text check(person_kind in ('employee','owner','contractor'));
create table public.os_hr_employees (
 id uuid primary key default gen_random_uuid(), profile_id uuid unique references public.os_profiles(id) on delete restrict,
 display_name text not null check(length(btrim(display_name)) between 1 and 120), legal_name text not null check(length(btrim(legal_name)) between 1 and 120),
 email text unique check(email=lower(email)), job_roles text[] not null default '{}', gender text check(gender in ('M','F','X')),
 birth_date date, address text, phone text, emergency_contact text, career_summary text,
 hire_date date not null check(hire_date between '1900-01-01' and '2199-12-31'),
 status text not null default 'active' check(status in ('active','on_leave','retired')),
 leave_from date, leave_to date, retire_date date, retire_reason text check(retire_reason in ('voluntary','contract_end','recommended','dismissal','retirement_age','other')),
 retention_until date, offboarding jsonb not null default '{}',
 check(status<>'on_leave' or (leave_from is not null and leave_to>=leave_from)),
 check(retire_date is null or (retire_date>=hire_date and retire_reason is not null))
);
create table public.os_hr_contracts (
 id uuid primary key default gen_random_uuid(), hr_employee_id uuid not null references public.os_hr_employees(id) on delete restrict,
 contract_type text not null check(contract_type in ('permanent','fixed_term','part_time')), start_date date not null, end_date date,
 probation_end date, weekly_hours numeric(4,1) not null check(weekly_hours between 1 and 40),
 work_days text not null default '월–금', work_time text not null default '', workplace text not null default '',
 reason text not null check(length(btrim(reason)) between 1 and 500), is_current boolean not null default true,
 created_by uuid references public.os_profiles(id) on delete restrict,
 check(end_date is null or end_date>=start_date), check(contract_type<>'fixed_term' or end_date is not null)
);
create unique index os_hr_contract_current on public.os_hr_contracts(hr_employee_id) where is_current;
create table public.os_hr_leave_credits (
 id uuid primary key default gen_random_uuid(), hr_employee_id uuid not null references public.os_hr_employees(id) on delete restrict,
 kind text not null check(kind in ('accrual_monthly','accrual_annual','adjustment','opening')),
 days numeric(5,1) not null check(days<>0 and mod(days,0.5)=0), entry_date date not null,
 period_start date not null, period_end date not null check(period_end>=period_start), reason text,
 source text not null check(source in ('auto','manual','migration')), evidence_path text,
 created_by uuid references public.os_profiles(id) on delete restrict, created_at timestamptz not null default now(),
 check(kind not in ('adjustment','opening') or length(btrim(reason)) between 1 and 500),
 check(kind not like 'accrual_%' or (days>0 and source='auto'))
);
create unique index os_hr_accrual_once on public.os_hr_leave_credits(hr_employee_id,kind,entry_date) where kind like 'accrual_%';
create unique index os_hr_opening_once on public.os_hr_leave_credits(hr_employee_id,period_start) where kind='opening';
create table public.os_hr_leave_requests (
 id uuid primary key default gen_random_uuid(), hr_employee_id uuid not null references public.os_hr_employees(id) on delete restrict,
 leave_type text not null check(leave_type in ('annual','half_am','half_pm','sick','family_event','public_duty','unpaid','other')),
 start_date date not null, end_date date not null check(end_date>=start_date), days numeric(5,1) not null check(days>0), deducts boolean not null,
 reason text check(length(reason)<=500), proof_path text, status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
 requested_by uuid references public.os_profiles(id) on delete restrict, requested_at timestamptz not null default now(),
 decided_by uuid references public.os_profiles(id) on delete restrict, decided_at timestamptz, reject_reason text,
 cancelled_by uuid references public.os_profiles(id) on delete restrict, cancelled_at timestamptz,
 legacy_record_id uuid unique references public.os_records(id) on delete restrict,
 check(leave_type not in ('half_am','half_pm') or start_date=end_date),
 check(status<>'rejected' or length(btrim(reject_reason)) between 1 and 500)
);
create index os_hr_requests_person_date on public.os_hr_leave_requests(hr_employee_id,start_date);
create index os_hr_requests_dates on public.os_hr_leave_requests(start_date,end_date);
create index os_hr_requests_status on public.os_hr_leave_requests(status);
create table public.os_hr_leave_promotions (
 id uuid primary key default gen_random_uuid(), hr_employee_id uuid not null references public.os_hr_employees(id) on delete restrict,
 period_start date not null, period_end date not null, step text not null check(step in ('notice_1','designation_2','notice_1_extra','designation_2_extra','refusal')),
 due_date date not null, sent_at timestamptz not null default now(), sent_by uuid references public.os_profiles(id) on delete restrict,
 channel text not null check(channel in ('os_email','paper')), days numeric(5,1) not null check(days>=0), designated_dates date[] not null default '{}',
 body text not null check(length(body) between 1 and 16000), paper_path text, read_at timestamptz,
 reply_at timestamptz, reply_days numeric(5,1), reply_dates date[] not null default '{}', settlement_marked_at timestamptz,
 unique(hr_employee_id,period_start,step)
);
create table public.os_hr_documents (
 id uuid primary key default gen_random_uuid(), hr_employee_id uuid not null references public.os_hr_employees(id) on delete restrict,
 doc_kind text not null check(doc_kind in ('contract_signed','contract_given','roster','privacy','nda','insurance')),
 status text not null default 'missing' check(status in ('done','missing')), done_date date, file_path text,
 unique(hr_employee_id,doc_kind), check(status<>'done' or done_date is not null)
);
create table public.os_hr_forms (
 id uuid primary key default gen_random_uuid(), kind text not null, title text not null check(length(title) between 1 and 120),
 usage text not null default '', file_path text, version_label text not null default '검토 전', reviewed_at timestamptz,
 reviewed_by uuid references public.os_profiles(id) on delete restrict
);
create table public.os_hr_holidays (
 day date primary key, name text not null check(length(btrim(name)) between 1 and 40),
 kind text not null check(kind in ('national','substitute','temporary','manual')),
 source text not null check(source in ('api','manual')), synced_at timestamptz
);
create table public.os_hr_settings (key text primary key, value jsonb not null);
create table public.os_hr_events (
 id bigint generated always as identity primary key, actor uuid references public.os_profiles(id) on delete restrict,
 hr_employee_id uuid references public.os_hr_employees(id) on delete restrict, profile_id uuid references public.os_profiles(id) on delete restrict,
 action text not null, detail jsonb not null default '{}', reason text check(length(reason)<=500), created_at timestamptz not null default now()
);
create index os_hr_events_employee on public.os_hr_events(hr_employee_id,created_at desc);
create index os_hr_events_profile on public.os_hr_events(profile_id,created_at desc);
create index os_hr_events_actor on public.os_hr_events(actor);
create index os_hr_employee_retirement on public.os_hr_employees(retire_date) where retire_date is not null;
create index os_hr_credits_period on public.os_hr_leave_credits(hr_employee_id,period_start);
-- Version counters stay inside the transaction; clients cannot supply audit timestamps.
do $$ declare t text; begin
 foreach t in array array['employees','contracts','leave_requests','leave_promotions','documents','forms','holidays','settings'] loop
  execute format('alter table public.os_hr_%I add column created_at timestamptz not null default now(), add column updated_at timestamptz not null default now(), add column updated_by uuid references public.os_profiles(id) on delete restrict, add column version integer not null default 1',t);
  execute format('create index on public.os_hr_%I(updated_by)',t);
 end loop;
end $$;
create function os_hr_private.touch() returns trigger language plpgsql set search_path='' as $$ begin new.version:=old.version+1;new.updated_at:=now();new.updated_by:=auth.uid();return new;end $$;
create function os_hr_private.immutable() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'HR_IMMUTABLE';end $$;
do $$ declare t text; begin
 foreach t in array array['employees','contracts','leave_requests','leave_promotions','documents','forms','holidays','settings'] loop
  execute format('create trigger os_hr_touch before update on public.os_hr_%I for each row execute function os_hr_private.touch()',t);
 end loop;
 foreach t in array array['leave_credits','events'] loop
  execute format('create trigger os_hr_immutable before update or delete on public.os_hr_%I for each row execute function os_hr_private.immutable()',t);
 end loop;
end $$;
insert into public.os_hr_settings(key,value) values ('leave_basis','"hire_date"'),('half_day','true'),('quarter_day','false'),('carry_over','false'),('leave_approvers','[]');
insert into public.os_hr_forms(kind,title,usage) values
 ('contract_permanent','표준 근로계약서 · 정규직','근로계약'),('contract_fixed','표준 근로계약서 · 기간제','근로계약'),('contract_part','표준 근로계약서 · 단시간','근로계약'),
 ('privacy','개인정보 수집·이용 동의서','개인정보'),('nda','비밀유지 서약서','비밀유지'),('notice_1','연차 사용 촉구서','사용 촉진'),('designation_2','연차 사용 시기 지정 통보서','사용 촉진');
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('hr-documents','hr-documents',false,10485760,array['application/pdf','image/jpeg','image/png']);

create function public.os_hr_session_active() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.os_profiles p where p.id=auth.uid() and p.is_active)
 and not exists(select 1 from public.os_hr_employees e where e.profile_id=auth.uid() and (e.status='retired' or e.retire_date<(now() at time zone 'Asia/Seoul')::date))
$$;
create function public.os_has_hr_access() returns boolean language sql stable security definer set search_path='' as $$
 select public.os_hr_session_active() and exists(select 1 from public.os_profiles where id=auth.uid() and (role='admin' or finance_access))
$$;
create function public.os_hr_my_employee_id() returns uuid language sql stable security definer set search_path='' as $$
 select e.id from public.os_hr_employees e join public.os_profiles p on p.id=e.profile_id
 where p.id=auth.uid() and p.person_kind='employee' and not p.is_shared_account and public.os_hr_session_active()
$$;
create function os_hr_private.authorize(p_employee uuid default null,p_operator boolean default true) returns void language plpgsql security definer set search_path='' as $$ begin
 if not public.os_hr_session_active() or (not public.os_has_hr_access() and (p_operator or p_employee is distinct from public.os_hr_my_employee_id())) then raise exception using errcode='42501',message='HR_ACCESS_REQUIRED';end if;
end $$;
create function os_hr_private.reason(p_reason text) returns void language plpgsql set search_path='' as $$ begin
 if length(btrim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'REASON_REQUIRED';end if;
end $$;
create function os_hr_private.event(p_employee uuid,p_action text,p_detail jsonb default '{}',p_reason text default null,p_profile uuid default null) returns void language sql security definer set search_path='' as $$
 insert into public.os_hr_events(actor,hr_employee_id,profile_id,action,detail,reason) values(auth.uid(),p_employee,p_profile,p_action,p_detail,p_reason)
$$;
create function os_hr_private.period(p_hire date,p_at date) returns table(start_date date,end_date date,first_year boolean) language plpgsql immutable set search_path='' as $$
 declare y int:=greatest(0,extract(year from p_at)::int-extract(year from p_hire)::int);begin
 if (p_hire+make_interval(years=>y))::date>p_at then y:=greatest(0,y-1);end if;
 return query select (p_hire+make_interval(years=>y))::date,(p_hire+make_interval(years=>y+1))::date-1,y=0;
 end $$;
create function os_hr_private.accruals(p_hire date,p_through date) returns table(entry_date date,kind text,days numeric,period_start date,period_end date) language sql immutable set search_path='' as $$
 with dates as (
 select (p_hire+make_interval(months=>n))::date d,'accrual_monthly'::text k,1::numeric v from generate_series(1,11) n
 union all select (p_hire+make_interval(years=>n))::date,'accrual_annual',least(25,15+(n-1)/2)::numeric from generate_series(1,greatest(0,extract(year from p_through)::int-extract(year from p_hire)::int)) n
 ) select d,k,v,p.start_date,p.end_date from dates cross join lateral os_hr_private.period(p_hire,d) p where d<=p_through
$$;
create function os_hr_private.workdays(p_start date,p_end date) returns numeric language sql stable security definer set search_path='' as $$
 select count(*)::numeric from generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') d where extract(isodow from d)<6 and not exists(select 1 from public.os_hr_holidays where day=d::date)
$$;
create function os_hr_private.balance(p_employee uuid,p_at date,p_today date,p_exclude uuid default null) returns numeric language plpgsql stable security definer set search_path='' as $$
 declare e public.os_hr_employees;p record;v numeric;begin
 select * into strict e from public.os_hr_employees where id=p_employee;select * into p from os_hr_private.period(e.hire_date,p_at);
 select coalesce(sum(a.days),0) into v from os_hr_private.accruals(e.hire_date,least(greatest(p_at,p_today),coalesce(e.retire_date,'2199-12-31'::date))) a where a.period_start=p.start_date;
 select v+coalesce(sum(days),0) into v from public.os_hr_leave_credits where hr_employee_id=e.id and kind in ('adjustment','opening') and period_start=p.start_date and entry_date<=greatest(p_at,p_today);
 select v-coalesce(sum(days),0) into v from public.os_hr_leave_requests where hr_employee_id=e.id and status='approved' and deducts and start_date between p.start_date and p.end_date and id is distinct from p_exclude;
 return v;end $$;
create function os_hr_private.file(p_path text,p_purpose text,p_employee uuid default null) returns void language plpgsql stable security definer set search_path='' as $$ begin
 if nullif(p_path,'') is null then return;end if;
 if p_path !~ ('^'||p_purpose||'/'||coalesce(p_employee::text,'form')||'/[0-9a-f-]{36}\.(pdf|jpg|png)$')
 or not exists(select 1 from storage.objects where bucket_id='hr-documents' and name=p_path) then raise exception 'INVALID_FILE';end if;
end $$;
-- No direct writes, even for administrators. Sensitive columns are returned only by audited RPCs.
do $$ declare t text;begin
 foreach t in array array['employees','contracts','leave_credits','leave_requests','leave_promotions','documents','forms','holidays','settings','events'] loop
  execute format('alter table public.os_hr_%I enable row level security',t);
  execute format('revoke all on public.os_hr_%I from public,anon,authenticated,service_role',t);
  if t<>'employees' then execute format('grant select on public.os_hr_%I to authenticated',t);end if;
  execute format('create policy os_hr_operator_read on public.os_hr_%I for select to authenticated using ((select public.os_has_hr_access()))',t);
 end loop;
end $$;
grant select(id) on public.os_hr_employees to service_role;
grant select(id,profile_id,display_name,email,job_roles,gender,emergency_contact,career_summary,hire_date,status,leave_from,leave_to,retire_date,retire_reason,retention_until,offboarding,version,created_at,updated_at,updated_by) on public.os_hr_employees to authenticated;
create policy os_hr_own_requests on public.os_hr_leave_requests for select to authenticated using(hr_employee_id=(select public.os_hr_my_employee_id()));
create policy os_hr_own_credits on public.os_hr_leave_credits for select to authenticated using(hr_employee_id=(select public.os_hr_my_employee_id()));
create policy os_hr_own_promotions on public.os_hr_leave_promotions for select to authenticated using(hr_employee_id=(select public.os_hr_my_employee_id()));
create policy os_hr_holidays_read on public.os_hr_holidays for select to authenticated using((select public.os_hr_session_active()));

create function public.os_hr_people() returns jsonb language plpgsql stable security definer set search_path='' as $$ declare result jsonb;begin
 perform os_hr_private.authorize();
 select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('legal_name',left(e.legal_name,1)||'••','birth_date',case when e.birth_date is null then null else to_char(e.birth_date,'YYYY-MM')||'-••' end,'phone',case when e.phone is null then null else left(e.phone,3)||'-••••-'||right(e.phone,4) end,'address',case when e.address is null then null else split_part(e.address,' ',1)||' '||split_part(e.address,' ',2)||' •••' end)),'[]') into result from public.os_hr_employees e;
 return result;end $$;
create function public.os_hr_reveal(p_employee uuid,p_fields text[]) returns jsonb language plpgsql security definer set search_path='' as $$ declare rowdata jsonb;result jsonb;begin
 perform os_hr_private.authorize();
 if cardinality(p_fields) not between 1 and 4 or not p_fields <@ array['legal_name','birth_date','phone','address'] then raise exception 'INVALID_FIELDS';end if;
 select to_jsonb(e) into rowdata from public.os_hr_employees e where id=p_employee;if rowdata is null then raise exception 'HR_NOT_FOUND';end if;
 select jsonb_object_agg(key,value) into result from jsonb_each(rowdata) where key=any(p_fields);
 perform os_hr_private.event(p_employee,'reveal',jsonb_build_object('fields',p_fields));return result;end $$;
create function public.os_hr_log_view(p_employee uuid,p_fields text[]) returns void language plpgsql security definer set search_path='' as $$ begin
 perform os_hr_private.authorize();if not p_fields<@array['export','file'] then raise exception 'INVALID_FIELDS';end if;
 perform os_hr_private.event(p_employee,'view',jsonb_build_object('fields',p_fields));end $$;
create function public.os_hr_upsert_employee(p_payload jsonb,p_version int default 0,p_reason text default null) returns uuid language plpgsql security definer set search_path='' as $$
 declare e public.os_hr_employees;n public.os_hr_employees;eid uuid;pid uuid:=nullif(p_payload->>'profile_id','')::uuid;k text:=p_payload->>'person_kind';doc text;begin
 perform os_hr_private.authorize();
 if jsonb_typeof(p_payload)<>'object' or exists(select 1 from jsonb_object_keys(p_payload) as keys(field) where field<>all(array['id','profile_id','person_kind','display_name','legal_name','email','job_roles','gender','birth_date','address','phone','emergency_contact','career_summary','hire_date','status','leave_from','leave_to','contract','affiliation','expected_updated_at'])) then raise exception 'INVALID_INPUT';end if;
 if k is null or k not in ('employee','owner','contractor','shared') then raise exception 'INVALID_INPUT';end if;
 if pid is not null then
  perform 1 from public.os_profiles where id=pid for update;if not found then raise exception 'HR_NOT_FOUND';end if;
  if p_payload ? 'expected_updated_at' and not exists(select 1 from public.os_profiles where id=pid and updated_at=(p_payload->>'expected_updated_at')::timestamptz) then raise exception 'VERSION_CONFLICT';end if;
 end if;
 eid:=nullif(p_payload->>'id','')::uuid;
 if eid is null and pid is not null then select id into eid from public.os_hr_employees where profile_id=pid;end if;
 if eid is not null then
  select * into e from public.os_hr_employees where id=eid for update;if not found then raise exception 'HR_NOT_FOUND';end if;
  if e.version is distinct from p_version then raise exception 'VERSION_CONFLICT';end if;
  if pid is distinct from e.profile_id then raise exception 'INVALID_INPUT';end if;
  perform os_hr_private.reason(p_reason);
  if p_payload ? 'hire_date' and (p_payload->>'hire_date')::date<>e.hire_date then raise exception 'HIRE_DATE_IMMUTABLE';end if;
  if p_payload ? 'status' and (p_payload->>'status' not in ('active','on_leave') or e.retire_date is not null) then raise exception 'RETIREMENT_LOCKED';end if;
 end if;
 if k<>'employee' and pid is null then raise exception 'ACCOUNT_REQUIRED';end if;
 if (k='shared' or exists(select 1 from public.os_profiles where id=pid and is_shared_account)) and not exists(select 1 from public.os_profiles where id=auth.uid() and role='admin') then raise exception using errcode='42501',message='ADMIN_REQUIRED';end if;
 if eid is not null then
  n:=jsonb_populate_record(e,p_payload-array['id','profile_id','person_kind','contract','affiliation','expected_updated_at']);
  if n.status='on_leave' and (n.leave_from is null or n.leave_to is null or n.leave_to<n.leave_from) then raise exception 'LEAVE_DATES_REQUIRED';end if;
  update public.os_hr_employees set display_name=n.display_name,legal_name=n.legal_name,email=lower(n.email),job_roles=n.job_roles,gender=n.gender,birth_date=n.birth_date,address=n.address,phone=n.phone,emergency_contact=n.emergency_contact,career_summary=n.career_summary,status=n.status,leave_from=n.leave_from,leave_to=n.leave_to where id=eid;
 elsif k='employee' then
  if nullif(btrim(p_payload->>'legal_name'),'') is null then raise exception 'LEGAL_NAME_REQUIRED';end if;
  insert into public.os_hr_employees(profile_id,display_name,legal_name,email,job_roles,gender,birth_date,address,phone,emergency_contact,career_summary,hire_date)
  values(pid,p_payload->>'display_name',p_payload->>'legal_name',lower(nullif(p_payload->>'email','')),coalesce(array(select jsonb_array_elements_text(p_payload->'job_roles')),'{}'),nullif(p_payload->>'gender',''),nullif(p_payload->>'birth_date','')::date,p_payload->>'address',p_payload->>'phone',p_payload->>'emergency_contact',p_payload->>'career_summary',(p_payload->>'hire_date')::date) returning id into eid;
  foreach doc in array array['contract_signed','contract_given','roster','privacy','nda','insurance'] loop insert into public.os_hr_documents(hr_employee_id,doc_kind) values(eid,doc);end loop;
  if p_payload->'contract' is null then raise exception 'CONTRACT_REQUIRED';end if;
  n.id:=eid;
  insert into public.os_hr_contracts(hr_employee_id,contract_type,start_date,end_date,probation_end,weekly_hours,work_days,work_time,workplace,reason,created_by)
  values(eid,p_payload#>>'{contract,contract_type}',(p_payload->>'hire_date')::date,nullif(p_payload#>>'{contract,end_date}','')::date,nullif(p_payload#>>'{contract,probation_end}','')::date,(p_payload#>>'{contract,weekly_hours}')::numeric,coalesce(p_payload#>>'{contract,work_days}','월–금'),coalesce(p_payload#>>'{contract,work_time}',''),coalesce(p_payload#>>'{contract,workplace}',''),'최초 등록',auth.uid());
 end if;
 if pid is not null then
  update public.os_profiles set person_kind=case when k='shared' then null else k end,is_shared_account=(k='shared'),display_name=p_payload->>'display_name',roles=coalesce(array(select jsonb_array_elements_text(p_payload->'job_roles')),roles),affiliation=coalesce(p_payload->>'affiliation',affiliation),updated_at=now() where id=pid;
 end if;
 perform os_hr_private.event(eid,case when e.id is null then 'employee.created' else 'employee.updated' end,jsonb_build_object('fields',array(select jsonb_object_keys(p_payload)),'values','changed'),p_reason,pid);
 return coalesce(pid,eid);
 exception when unique_violation then raise exception 'EMAIL_TAKEN';end $$;
create function public.os_hr_change_contract(p_employee uuid,p_payload jsonb,p_reason text,p_current uuid) returns uuid language plpgsql security definer set search_path='' as $$ declare result uuid;begin
 perform os_hr_private.authorize();perform os_hr_private.reason(p_reason);
 perform 1 from public.os_hr_employees where id=p_employee for update;if not found then raise exception 'HR_NOT_FOUND';end if;
 if p_current is distinct from (select id from public.os_hr_contracts where hr_employee_id=p_employee and is_current) then raise exception 'VERSION_CONFLICT';end if;
 if (p_payload->>'start_date')::date<(select hire_date from public.os_hr_employees where id=p_employee) then raise exception 'INVALID_DATES';end if;
 update public.os_hr_contracts set is_current=false where hr_employee_id=p_employee and is_current;
 insert into public.os_hr_contracts(hr_employee_id,contract_type,start_date,end_date,probation_end,weekly_hours,work_days,work_time,workplace,reason,created_by)
 values(p_employee,p_payload->>'contract_type',(p_payload->>'start_date')::date,nullif(p_payload->>'end_date','')::date,nullif(p_payload->>'probation_end','')::date,(p_payload->>'weekly_hours')::numeric,coalesce(p_payload->>'work_days','월–금'),coalesce(p_payload->>'work_time',''),coalesce(p_payload->>'workplace',''),p_reason,auth.uid()) returning id into result;
 perform os_hr_private.event(p_employee,'contract.documents_archived',jsonb_build_object('documents',(select jsonb_agg(to_jsonb(d)) from public.os_hr_documents d where d.hr_employee_id=p_employee and d.doc_kind in ('contract_signed','contract_given'))),p_reason);
 update public.os_hr_documents set status='missing',done_date=null,file_path=null where hr_employee_id=p_employee and doc_kind in ('contract_signed','contract_given');
 perform os_hr_private.event(p_employee,'contract.changed',jsonb_build_object('contract',result),p_reason);return result;end $$;
create function public.os_hr_retire(p_employee uuid,p_version int,p_date date,p_reason text,p_offboarding jsonb) returns void language plpgsql security definer set search_path='' as $$ declare e public.os_hr_employees;today date:=(now() at time zone 'Asia/Seoul')::date;begin
 perform os_hr_private.authorize();select * into e from public.os_hr_employees where id=p_employee for update;
 if not found then raise exception 'HR_NOT_FOUND';end if;if e.version<>p_version then raise exception 'VERSION_CONFLICT';end if;
 if p_date<e.hire_date or p_date is null then raise exception 'INVALID_DATES';end if;
 if p_reason not in ('voluntary','contract_end','recommended','dismissal','retirement_age','other') then raise exception 'REASON_REQUIRED';end if;
 if jsonb_typeof(p_offboarding)<>'object' or exists(select 1 from jsonb_each(p_offboarding) where key not in ('insurance','settlement','handoff') or jsonb_typeof(value)<>'boolean') then raise exception 'INVALID_INPUT';end if;
 update public.os_hr_employees set retire_date=p_date,retire_reason=p_reason,retention_until=(p_date+interval '3 years')::date,offboarding=p_offboarding,status=case when p_date<today then 'retired' else 'active' end where id=e.id;
 update public.os_hr_leave_requests set status='cancelled',cancelled_by=auth.uid(),cancelled_at=now() where hr_employee_id=e.id and end_date>p_date and status in ('pending','approved');
 if p_date<today and e.profile_id is not null then update public.os_profiles set is_active=false where id=e.profile_id;end if;
 perform os_hr_private.event(e.id,'employee.retired',jsonb_build_object('date',p_date,'retentionUntil',(p_date+interval '3 years')::date),p_reason);end $$;

create function os_hr_private.validate_leave(p_employee uuid,p_type text,p_start date,p_end date,p_exclude uuid default null) returns numeric language plpgsql stable security definer set search_path='' as $$
 declare e public.os_hr_employees;p record;n numeric;today date:=(now() at time zone 'Asia/Seoul')::date;begin
 select * into e from public.os_hr_employees where id=p_employee;if not found then raise exception 'HR_NOT_FOUND';end if;
 if p_type not in ('annual','half_am','half_pm','sick','family_event','public_duty','unpaid','other') then raise exception 'INVALID_INPUT';end if;
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>366 or (p_type in ('half_am','half_pm') and p_start<>p_end) then raise exception 'INVALID_DATES';end if;
 if e.status='retired' or p_start<e.hire_date or (e.retire_date is not null and p_end>e.retire_date) or
 (e.profile_id is not null and not exists(select 1 from public.os_profiles where id=e.profile_id and person_kind='employee' and not is_shared_account)) then raise exception 'NOT_ELIGIBLE';end if;
 n:=os_hr_private.workdays(p_start,p_end);if n=0 then raise exception 'NO_WORKDAYS';end if;
 if p_type in ('half_am','half_pm') then n:=0.5;end if;
 select * into p from os_hr_private.period(e.hire_date,p_start);
 if p_type in ('annual','half_am','half_pm') and p_end>p.end_date then raise exception 'CROSSES_PERIOD';end if;
 if exists(select 1 from public.os_hr_leave_requests where hr_employee_id=e.id and status in ('pending','approved') and start_date<=p_end and end_date>=p_start and id is distinct from p_exclude) then raise exception 'OVERLAP_SELF';end if;
 if p_type in ('annual','half_am','half_pm') and n>os_hr_private.balance(e.id,p_start,today,p_exclude) then raise exception 'INSUFFICIENT_LEAVE';end if;
 return n;end $$;
create function public.os_hr_request_leave(p_employee uuid,p_type text,p_start date,p_end date,p_reason text default null,p_proof text default null,p_direct boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
 declare n numeric;result uuid;direct boolean;begin
 perform os_hr_private.authorize(p_employee,false);
 -- Every balance-changing RPC locks this employee first: concurrent approvals serialize.
 perform 1 from public.os_hr_employees where id=p_employee for update;if not found then raise exception 'HR_NOT_FOUND';end if;
 n:=os_hr_private.validate_leave(p_employee,p_type,p_start,p_end);
 if length(coalesce(p_reason,''))>500 then raise exception 'INVALID_INPUT';end if;
 if p_type='other' then perform os_hr_private.reason(p_reason);end if;
 if p_type not in ('sick','family_event','public_duty') and nullif(p_proof,'') is not null then raise exception 'INVALID_FILE';end if;
 perform os_hr_private.file(p_proof,'leave_proof',p_employee);
 direct:=coalesce(p_direct,false) and public.os_has_hr_access();
 insert into public.os_hr_leave_requests(hr_employee_id,leave_type,start_date,end_date,days,deducts,reason,proof_path,status,requested_by,decided_by,decided_at)
 values(p_employee,p_type,p_start,p_end,n,p_type in ('annual','half_am','half_pm'),p_reason,p_proof,case when direct then 'approved' else 'pending' end,auth.uid(),case when direct then auth.uid() end,case when direct then now() end) returning id into result;
 perform os_hr_private.event(p_employee,'leave.requested',jsonb_build_object('request',result,'days',n,'direct',direct));return result;end $$;
create function public.os_hr_decide_leave(p_id uuid,p_version int,p_decision text,p_reason text default null) returns void language plpgsql security definer set search_path='' as $$
 declare r public.os_hr_leave_requests;e uuid;n numeric;begin
 perform os_hr_private.authorize();select hr_employee_id into e from public.os_hr_leave_requests where id=p_id;
 if e is null then raise exception 'HR_NOT_FOUND';end if;
 perform 1 from public.os_hr_employees where id=e for update;
 select * into r from public.os_hr_leave_requests where id=p_id for update;
 if r.version<>p_version then raise exception 'VERSION_CONFLICT';end if;
 if r.status<>'pending' then raise exception 'ALREADY_DECIDED';end if;
 if p_decision not in ('approved','rejected') then raise exception 'INVALID_INPUT';end if;
 if p_decision='rejected' then perform os_hr_private.reason(p_reason);else
  n:=os_hr_private.validate_leave(e,r.leave_type,r.start_date,r.end_date,r.id);
 end if;
 update public.os_hr_leave_requests set status=p_decision,days=coalesce(n,r.days),decided_by=auth.uid(),decided_at=now(),reject_reason=case when p_decision='rejected' then p_reason end where id=p_id;
 perform os_hr_private.event(e,'leave.'||p_decision,jsonb_build_object('request',p_id),p_reason);end $$;
create function public.os_hr_cancel_leave(p_id uuid,p_version int) returns void language plpgsql security definer set search_path='' as $$
 declare r public.os_hr_leave_requests;e uuid;today date:=(now() at time zone 'Asia/Seoul')::date;begin
 select hr_employee_id into e from public.os_hr_leave_requests where id=p_id;perform os_hr_private.authorize(e,false);
 perform 1 from public.os_hr_employees where id=e for update;select * into r from public.os_hr_leave_requests where id=p_id for update;
 if not found then raise exception 'HR_NOT_FOUND';end if;if r.version<>p_version then raise exception 'VERSION_CONFLICT';end if;
 if not ((r.status='pending' and (e=public.os_hr_my_employee_id() or public.os_has_hr_access())) or (r.status='approved' and r.start_date>today and public.os_has_hr_access())) then raise exception 'NOT_CANCELLABLE';end if;
 update public.os_hr_leave_requests set status='cancelled',cancelled_by=auth.uid(),cancelled_at=now() where id=p_id;
 perform os_hr_private.event(e,'leave.cancelled',jsonb_build_object('request',p_id,'restored',case when r.status='approved' and r.deducts then r.days else 0 end));end $$;
create function public.os_hr_add_credit(p_employee uuid,p_days numeric,p_reason text,p_kind text default 'adjustment',p_evidence text default null) returns uuid language plpgsql security definer set search_path='' as $$
 declare e public.os_hr_employees;p record;result uuid;today date:=(now() at time zone 'Asia/Seoul')::date;begin
 perform os_hr_private.authorize();perform os_hr_private.reason(p_reason);
 if p_days is null or p_days=0 or abs(p_days)>999 or mod(p_days,0.5)<>0 or p_kind not in ('adjustment','opening') then raise exception 'INVALID_DAYS';end if;
 if p_kind='opening' and not public.os_is_admin() then raise exception using errcode='42501',message='ADMIN_REQUIRED';end if;
 select * into e from public.os_hr_employees where id=p_employee for update;if not found then raise exception 'HR_NOT_FOUND';end if;
 select * into p from os_hr_private.period(e.hire_date,today);perform os_hr_private.file(p_evidence,'credit_evidence',e.id);
 insert into public.os_hr_leave_credits(hr_employee_id,kind,days,entry_date,period_start,period_end,reason,source,created_by,evidence_path)
 values(e.id,p_kind,p_days,today,p.start_date,p.end_date,p_reason,case when p_kind='opening' then 'migration' else 'manual' end,auth.uid(),p_evidence) returning id into result;
 perform os_hr_private.event(e.id,'credit.added',jsonb_build_object('credit',result,'days',p_days,'kind',p_kind),p_reason);return result;
 exception when unique_violation then raise exception 'ALREADY_IMPORTED';end $$;
create function public.os_hr_send_promotion(p_employee uuid,p_step text,p_days numeric,p_dates date[],p_channel text,p_body text,p_paper text default null) returns uuid language plpgsql security definer set search_path='' as $$
 declare e public.os_hr_employees;p record;one public.os_hr_leave_promotions;start1 date;end1 date;due2 date;today date:=(now() at time zone 'Asia/Seoul')::date;n numeric;result uuid;d date;extra boolean;begin
 perform os_hr_private.authorize();select * into e from public.os_hr_employees where id=p_employee for update;if not found then raise exception 'HR_NOT_FOUND';end if;
 if e.status='retired' or e.hire_date>today then raise exception 'NOT_ELIGIBLE';end if;
 select * into p from os_hr_private.period(e.hire_date,today);
 extra:=p_step in ('notice_1_extra','designation_2_extra');
 if p_step not in ('notice_1','designation_2','notice_1_extra','designation_2_extra','refusal') or (extra and not p.first_year) then raise exception 'INVALID_INPUT';end if;
 start1:=((p.end_date+1)-make_interval(months=>case when extra then 1 when p.first_year then 3 else 6 end))::date;
 end1:=start1+case when extra then 4 else 9 end;
 due2:=case when extra then p.end_date-10 else ((p.end_date+1)-make_interval(months=>case when p.first_year then 1 else 2 end))::date-1 end;
 n:=greatest(0,os_hr_private.balance(e.id,today,today));
 if extra then
  select * into one from public.os_hr_leave_promotions where hr_employee_id=e.id and period_start=p.start_date and step='notice_1';
  if not found then raise exception 'NOT_IN_WINDOW';end if;
  select count(*) into n from os_hr_private.accruals(e.hire_date,p.end_date) a where a.kind='accrual_monthly' and a.entry_date>(one.sent_at at time zone 'Asia/Seoul')::date;
 end if;
 if p_step in ('notice_1','notice_1_extra') then
  if today not between start1 and end1 or n<=0 then raise exception 'NOT_IN_WINDOW';end if;
 else
  select * into one from public.os_hr_leave_promotions where hr_employee_id=e.id and period_start=p.start_date and step=case when extra then 'notice_1_extra' else 'notice_1' end;
  if not found or today>due2 or (one.reply_at is null and today<=(one.sent_at at time zone 'Asia/Seoul')::date+10) then raise exception 'NOT_IN_WINDOW';end if;
  n:=greatest(0,n-coalesce(one.reply_days,0));
  if cardinality(p_dates)=0 or n<=0 or cardinality(p_dates)<ceil(n) or cardinality(p_dates)>366 or cardinality(p_dates)<>(select count(distinct x) from unnest(p_dates) x) then raise exception 'DATES_REQUIRED';end if;
  foreach d in array p_dates loop if d<today or d>p.end_date or os_hr_private.workdays(d,d)=0 then raise exception 'INVALID_DATES';end if;end loop;
 end if;
 if p_days is distinct from n then raise exception 'VERSION_CONFLICT';end if;
 if p_channel not in ('os_email','paper') or length(btrim(p_body)) not between 1 and 16000 then raise exception 'INVALID_INPUT';end if;
 if p_channel='paper' and nullif(p_paper,'') is null then raise exception 'PROOF_REQUIRED';end if;
 perform os_hr_private.file(p_paper,'promotion_paper',e.id);
 insert into public.os_hr_leave_promotions(hr_employee_id,period_start,period_end,step,due_date,sent_by,channel,days,designated_dates,body,paper_path)
 values(e.id,p.start_date,p.end_date,p_step,case when p_step like 'notice_%' then end1 else due2 end,auth.uid(),p_channel,n,coalesce(p_dates,'{}'),p_body,p_paper) returning id into result;
 perform os_hr_private.event(e.id,'promotion.sent',jsonb_build_object('promotion',result,'step',p_step,'channel',p_channel,'days',n));return result;
 exception when unique_violation then raise exception 'ALREADY_SENT';end $$;
create function public.os_hr_reply_promotion(p_id uuid,p_dates date[]) returns void language plpgsql security definer set search_path='' as $$
 declare r public.os_hr_leave_promotions;d date;today date:=(now() at time zone 'Asia/Seoul')::date;n int;begin
 select * into r from public.os_hr_leave_promotions where id=p_id for update;
 if not found or r.hr_employee_id is distinct from public.os_hr_my_employee_id() then raise exception using errcode='42501',message='HR_ACCESS_REQUIRED';end if;
 if r.step not in ('notice_1','notice_1_extra') or today>(r.sent_at at time zone 'Asia/Seoul')::date+10 or r.reply_at is not null then raise exception 'NOT_IN_WINDOW';end if;
 n:=cardinality(p_dates);if n is null or n=0 or n>ceil(r.days) or n<>(select count(distinct x) from unnest(p_dates) x) then raise exception 'DATES_REQUIRED';end if;
 foreach d in array p_dates loop if d<today or d>r.period_end or os_hr_private.workdays(d,d)=0 then raise exception 'INVALID_DATES';end if;end loop;
 update public.os_hr_leave_promotions set reply_at=now(),reply_days=least(n,r.days),reply_dates=p_dates where id=p_id;
 perform os_hr_private.event(r.hr_employee_id,'promotion.replied',jsonb_build_object('promotion',r.id,'days',least(n,r.days)));end $$;
create function public.os_hr_mark_promotion_read(p_id uuid) returns void language plpgsql security definer set search_path='' as $$ declare e uuid;begin
 update public.os_hr_leave_promotions set read_at=now() where id=p_id and hr_employee_id=public.os_hr_my_employee_id() and read_at is null returning hr_employee_id into e;
 if e is not null then perform os_hr_private.event(e,'promotion.read',jsonb_build_object('promotion',p_id));
 elsif not exists(select 1 from public.os_hr_leave_promotions where id=p_id and hr_employee_id=public.os_hr_my_employee_id()) then raise exception using errcode='42501',message='HR_ACCESS_REQUIRED';end if;
 end $$;
create function public.os_hr_mark_settlement(p_employee uuid) returns void language plpgsql security definer set search_path='' as $$
 declare e public.os_hr_employees;p record;one public.os_hr_leave_promotions;today date:=(now() at time zone 'Asia/Seoul')::date;deadline date;n numeric;begin
 perform os_hr_private.authorize();select * into e from public.os_hr_employees where id=p_employee for update;if not found then raise exception 'HR_NOT_FOUND';end if;
 select * into p from os_hr_private.period(e.hire_date,today);
 if exists(select 1 from public.os_hr_leave_promotions where hr_employee_id=e.id and period_start=p.start_date and settlement_marked_at is not null) then raise exception 'ALREADY_MARKED';end if;
 select * into one from public.os_hr_leave_promotions where hr_employee_id=e.id and period_start=p.start_date and step='notice_1';
 deadline:=case when one.id is null then ((p.end_date+1)-make_interval(months=>case when p.first_year then 3 else 6 end))::date+9 else ((p.end_date+1)-make_interval(months=>case when p.first_year then 1 else 2 end))::date-1 end;
 n:=greatest(0,os_hr_private.balance(e.id,today,today));
 if today<=deadline or n<=0 or exists(select 1 from public.os_hr_leave_promotions where hr_employee_id=e.id and period_start=p.start_date and step='designation_2') then raise exception 'NOT_IN_WINDOW';end if;
 insert into public.os_hr_leave_promotions(hr_employee_id,period_start,period_end,step,due_date,sent_by,channel,days,body,settlement_marked_at)
 values(e.id,p.start_date,p.end_date,'refusal',p.end_date,auth.uid(),'paper',n,'미사용 연차 수당 정산 대상 표시',now());
 perform os_hr_private.event(e.id,'settlement.marked',jsonb_build_object('days',n,'period',p.start_date));end $$;
create function public.os_hr_set_document(p_employee uuid,p_kind text,p_status text,p_date date,p_path text,p_version int) returns void language plpgsql security definer set search_path='' as $$ declare r public.os_hr_documents;begin
 perform os_hr_private.authorize();perform 1 from public.os_hr_employees where id=p_employee for update;
 select * into r from public.os_hr_documents where hr_employee_id=p_employee and doc_kind=p_kind for update;
 if not found then raise exception 'HR_NOT_FOUND';end if;if r.version<>p_version then raise exception 'VERSION_CONFLICT';end if;
 perform os_hr_private.file(p_path,'document',p_employee);
 update public.os_hr_documents set status=p_status,done_date=case when p_status='done' then p_date end,file_path=p_path where id=r.id;
 perform os_hr_private.event(p_employee,'document.updated',jsonb_build_object('kind',p_kind,'before',r.status,'after',p_status,'previousPath',r.file_path,'path',p_path,'fileChanged',r.file_path is distinct from p_path));end $$;
create function public.os_hr_set_form(p_id uuid,p_version int,p_title text,p_usage text,p_kind text,p_label text,p_path text) returns uuid language plpgsql security definer set search_path='' as $$ declare r public.os_hr_forms;result uuid;begin
 perform os_hr_private.authorize();perform os_hr_private.file(p_path,'form');
 if nullif(p_path,'') is null or length(btrim(p_label)) not between 1 and 60 then raise exception 'INVALID_INPUT';end if;
 if p_id is not null then
  select * into r from public.os_hr_forms where id=p_id for update;if not found then raise exception 'HR_NOT_FOUND';end if;if r.version<>p_version then raise exception 'VERSION_CONFLICT';end if;
  update public.os_hr_forms set title=p_title,usage=p_usage,kind=p_kind,version_label=p_label,file_path=p_path,reviewed_at=now(),reviewed_by=auth.uid() where id=p_id;result:=p_id;
 else insert into public.os_hr_forms(title,usage,kind,version_label,file_path,reviewed_at,reviewed_by) values(p_title,p_usage,p_kind,p_label,p_path,now(),auth.uid()) returning id into result;end if;
 perform os_hr_private.event(null,'form.updated',jsonb_build_object('form',result,'previousPath',r.file_path,'previousLabel',r.version_label,'versionLabel',p_label));return result;end $$;
create function public.os_hr_set_holiday(p_day date,p_name text) returns void language plpgsql security definer set search_path='' as $$ begin
 perform os_hr_private.authorize();if p_day is null or p_day not between '1900-01-01' and '2199-12-31' then raise exception 'INVALID_DATES';end if;
 insert into public.os_hr_holidays(day,name,kind,source) values(p_day,p_name,'manual','manual');
 perform os_hr_private.event(null,'holiday.added',jsonb_build_object('day',p_day));exception when unique_violation then raise exception 'HOLIDAY_EXISTS';end $$;
create function public.os_hr_remove_holiday(p_day date) returns void language plpgsql security definer set search_path='' as $$ begin
 perform os_hr_private.authorize();delete from public.os_hr_holidays where day=p_day and source='manual';if not found then raise exception 'HOLIDAY_NOT_MANUAL';end if;
 perform os_hr_private.event(null,'holiday.removed',jsonb_build_object('day',p_day));end $$;

create function public.os_hr_me() returns jsonb language plpgsql stable security definer set search_path='' as $$ declare e public.os_hr_employees;begin
 select * into e from public.os_hr_employees where id=public.os_hr_my_employee_id();if not found then return null;end if;
 return jsonb_build_object('id',e.id,'profile_id',e.profile_id,'display_name',e.display_name,'hire_date',e.hire_date,'status',e.status,'retire_date',e.retire_date,'leave_from',e.leave_from,'leave_to',e.leave_to,'version',e.version,'job_roles',e.job_roles);
 end $$;
create function public.os_hr_export(p_ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$ declare result jsonb;e uuid;begin
 perform os_hr_private.authorize();if cardinality(p_ids)>5000 then raise exception 'RANGE_REQUIRED';end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from public.os_hr_employees x where id=any(p_ids);
 foreach e in array p_ids loop perform os_hr_private.event(e,'export',jsonb_build_object('format','xlsx'));end loop;return result;end $$;
create function public.os_hr_set_account(p_profile uuid,p_payload jsonb,p_updated_at timestamptz) returns void language plpgsql security definer set search_path='' as $$ declare r public.os_profiles;begin
 perform os_hr_private.authorize();if not public.os_is_admin() then raise exception using errcode='42501',message='ADMIN_REQUIRED';end if;
 select * into r from public.os_profiles where id=p_profile for update;if not found then raise exception 'HR_NOT_FOUND';end if;
 if r.updated_at is distinct from p_updated_at then raise exception 'VERSION_CONFLICT';end if;
 if exists(select 1 from jsonb_object_keys(p_payload) as keys(field) where field<>all(array['role','is_active','finance_access','onboarding'])) then raise exception 'INVALID_INPUT';end if;
 if p_profile=auth.uid() and (p_payload->>'role'<>'admin' or p_payload->>'is_active'='false') then raise exception 'SELF_ADMIN_PROTECTED';end if;
 if p_payload->>'is_active'='true' and exists(select 1 from public.os_hr_employees where profile_id=p_profile and (status='retired' or retire_date<(now() at time zone 'Asia/Seoul')::date)) then raise exception 'RETIRED_ACCOUNT';end if;
 update public.os_profiles set role=coalesce((p_payload->>'role')::public.os_role,r.role),is_active=coalesce((p_payload->>'is_active')::boolean,r.is_active),finance_access=coalesce((p_payload->>'finance_access')::boolean,r.finance_access),onboarding=coalesce(p_payload->'onboarding',r.onboarding),updated_at=now() where id=p_profile;
 perform os_hr_private.event((select id from public.os_hr_employees where profile_id=p_profile),'account.updated',jsonb_build_object('fields',array(select jsonb_object_keys(p_payload))),null,p_profile);end $$;
create function public.os_hr_link_account(p_employee uuid,p_profile uuid,p_version int) returns void language plpgsql security definer set search_path='' as $$ declare e public.os_hr_employees;p public.os_profiles;begin
 perform os_hr_private.authorize();if not public.os_is_admin() then raise exception using errcode='42501',message='ADMIN_REQUIRED';end if;
 select * into e from public.os_hr_employees where id=p_employee for update;if not found then raise exception 'HR_NOT_FOUND';end if;
 if e.profile_id is not null then raise exception 'MEMBER_ACCOUNT_EXISTS';end if;if e.version<>p_version then raise exception 'VERSION_CONFLICT';end if;
 select * into p from public.os_profiles where id=p_profile for update;
 if not found or lower(p.email) is distinct from lower(e.email) then raise exception 'INVALID_ACCOUNT';end if;
 update public.os_hr_employees set profile_id=p_profile where id=e.id;
 update public.os_profiles set display_name=e.display_name,legal_name=e.legal_name,person_kind='employee',roles=e.job_roles,must_change_password=true,onboarding=jsonb_build_object('account',true),updated_at=now() where id=p_profile;
 perform os_hr_private.event(e.id,'account.created','{}',null,p_profile);end $$;

-- Retired people are refused by the HR server session gate immediately; this
-- restrictive policy also prevents direct HR reads using a still-valid JWT.
create function os_hr_private.notify(p_recipient uuid,p_source_type text,p_source uuid,p_key text,p_reason text default 'status_change') returns void language plpgsql security definer set search_path='' as $$ begin
 if p_recipient is null or p_recipient=auth.uid() or not exists(select 1 from public.os_profiles where id=p_recipient and is_active) then return;end if;
 insert into public.os_records(record_type,title,description,status,owner_id,created_by,updated_by,metadata)
 values('notification','업무 알림','','unread',p_recipient,auth.uid(),auth.uid(),jsonb_build_object('sourceType',p_source_type,'sourceId',p_source::text,'reason',p_reason,'readAt','','dedupeKey','hr:'||p_key||':'||p_recipient::text)) on conflict do nothing;
 end $$;
create function os_hr_private.notify_operators(p_employee uuid,p_key text) returns void language plpgsql security definer set search_path='' as $$ declare who uuid;begin
 for who in select id from public.os_profiles where is_active and (role='admin' or finance_access) loop perform os_hr_private.notify(who,'hr_employee',p_employee,p_key,'scheduled');end loop;
 end $$;
create function os_hr_private.leave_notification() returns trigger language plpgsql security definer set search_path='' as $$ declare who uuid;begin
 if tg_op='INSERT' and new.status='pending' then
  for who in select id from public.os_profiles where is_active and (role='admin' or finance_access) loop perform os_hr_private.notify(who,'hr_leave',new.id,'leave:'||new.id::text||':pending','approval');end loop;
 elsif tg_op='INSERT' or old.status is distinct from new.status then
  select profile_id into who from public.os_hr_employees where id=new.hr_employee_id;
  perform os_hr_private.notify(who,'hr_leave',new.id,'leave:'||new.id::text||':'||new.status);
 end if;return new;end $$;
create trigger os_hr_leave_notification after insert or update on public.os_hr_leave_requests for each row execute function os_hr_private.leave_notification();
create function os_hr_private.promotion_notification() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if tg_op='INSERT' and new.settlement_marked_at is null then perform os_hr_private.notify((select profile_id from public.os_hr_employees where id=new.hr_employee_id),'hr_promotion',new.id,'promotion:'||new.id::text,'scheduled');
 elsif tg_op='UPDATE' and old.reply_at is null and new.reply_at is not null then perform os_hr_private.notify_operators(new.hr_employee_id,'reply:'||new.id::text);end if;return new;end $$;
create trigger os_hr_promotion_notification after insert or update on public.os_hr_leave_promotions for each row execute function os_hr_private.promotion_notification();
create function os_hr_private.holiday_notification() returns trigger language plpgsql security definer set search_path='' as $$ declare day date;eid uuid;begin
 day:=case when tg_op='DELETE' then old.day else new.day end;
 for eid in select distinct hr_employee_id from public.os_hr_leave_requests where status in ('approved','pending') and day between start_date and end_date loop
  perform os_hr_private.notify_operators(eid,'holiday:'||day::text||':'||tg_op||':'||txid_current()::text);
 end loop;return coalesce(new,old);end $$;
create trigger os_hr_holiday_notification after insert or update or delete on public.os_hr_holidays for each row execute function os_hr_private.holiday_notification();
create function public.os_hr_cron_run() returns jsonb language plpgsql security definer set search_path='' as $$
 declare e public.os_hr_employees;c public.os_hr_contracts;p record;a record;one public.os_hr_leave_promotions;today date:=(now() at time zone 'Asia/Seoul')::date;start1 date;end1 date;due2 date;xs date;xe date;xd date;rows int;credits int:=0;retired int:=0;begin
 if coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='SERVICE_REQUIRED';end if;
 for e in select x.* from public.os_hr_employees x left join public.os_profiles prof on prof.id=x.profile_id where x.status<>'retired' and (prof.id is null or (prof.person_kind='employee' and not prof.is_shared_account)) order by x.id for update of x loop
  for a in select * from os_hr_private.accruals(e.hire_date,least(today,coalesce(e.retire_date,today))) loop
   insert into public.os_hr_leave_credits(hr_employee_id,kind,days,entry_date,period_start,period_end,source) values(e.id,a.kind,a.days,a.entry_date,a.period_start,a.period_end,'auto') on conflict do nothing;
   get diagnostics rows=row_count;credits:=credits+rows;
  end loop;
  if e.retire_date<today then
   update public.os_hr_employees set status='retired' where id=e.id;update public.os_profiles set is_active=false where id=e.profile_id;retired:=retired+1;
  end if;
  if e.status='on_leave' then perform os_hr_private.notify_operators(e.id,'attendance:'||e.id::text||':'||to_char(today,'YYYY-MM'));
   if e.leave_to<today then perform os_hr_private.notify_operators(e.id,'return:'||e.id::text||':'||e.leave_to::text);end if;
  end if;
  select * into c from public.os_hr_contracts where hr_employee_id=e.id and is_current;
  if c.end_date=today+30 then perform os_hr_private.notify_operators(e.id,'contract:'||c.id::text);end if;
  if c.probation_end=today+30 then perform os_hr_private.notify_operators(e.id,'probation:'||c.id::text);end if;
  if extract(isodow from today)=1 and exists(select 1 from public.os_hr_documents where hr_employee_id=e.id and status='missing') then perform os_hr_private.notify_operators(e.id,'documents:'||e.id::text||':'||today::text);end if;
  select * into p from os_hr_private.period(e.hire_date,today);
  start1:=((p.end_date+1)-make_interval(months=>case when p.first_year then 3 else 6 end))::date;end1:=start1+9;
  due2:=((p.end_date+1)-make_interval(months=>case when p.first_year then 1 else 2 end))::date-1;
  if today in (start1,end1-3,due2-7,due2-1) and os_hr_private.balance(e.id,today,today)>0 then perform os_hr_private.notify_operators(e.id,'promo:'||e.id::text||':'||today::text);end if;
  if p.first_year and exists(select 1 from public.os_hr_leave_promotions where hr_employee_id=e.id and period_start=p.start_date and step='notice_1') then
   xs:=((p.end_date+1)-interval '1 month')::date;xe:=xs+4;xd:=p.end_date-10;
   if today in (xs,xe-3,xd-7,xd-1) then perform os_hr_private.notify_operators(e.id,'promo-extra:'||e.id::text||':'||today::text);end if;
  end if;
 end loop;
 for e in select * from public.os_hr_employees where retention_until=today loop perform os_hr_private.notify_operators(e.id,'retention:'||e.id::text||':'||today::text);end loop;
 perform os_hr_private.event(null,'cron',jsonb_build_object('date',today,'credits',credits,'retired',retired));
 return jsonb_build_object('date',today,'credits',credits,'retired',retired);end $$;
create function public.os_hr_sync_holidays(p_rows jsonb) returns int language plpgsql security definer set search_path='' as $$ declare r jsonb;n int:=0;begin
 if coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='SERVICE_REQUIRED';end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>200 then raise exception 'INVALID_INPUT';end if;
 for r in select * from jsonb_array_elements(p_rows) loop
  insert into public.os_hr_holidays(day,name,kind,source,synced_at) values((r->>'day')::date,r->>'name',r->>'kind','api',now())
  on conflict(day) do update set name=excluded.name,kind=excluded.kind,synced_at=now() where os_hr_holidays.source='api' and (os_hr_holidays.name,os_hr_holidays.kind) is distinct from (excluded.name,excluded.kind);
  n:=n+1;
 end loop;perform os_hr_private.event(null,'holidays.synced',jsonb_build_object('count',n));return n;end $$;
-- New source types only; preserve the existing notification guard's behavior.
create or replace function public.os_notification_guard() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then
    if old.record_type='notification' then raise exception using errcode='23514',message='NOTIFICATION_IMMUTABLE'; end if;
    return old;
  end if;
  if tg_op='UPDATE' and (old.record_type='notification' or new.record_type='notification') then
    if old.record_type<>new.record_type
      or (to_jsonb(new)-array['status','metadata','updated_by','updated_at','version']) is distinct from
         (to_jsonb(old)-array['status','metadata','updated_by','updated_at','version'])
      or (new.metadata-'readAt') is distinct from (old.metadata-'readAt') then
      raise exception using errcode='23514',message='NOTIFICATION_IMMUTABLE';
    end if;
  end if;
  if new.record_type<>'notification' then return new; end if;
  if new.title<>'업무 알림' or new.description<>'' or new.status not in ('read','unread')
    or new.owner_id is null
    or (new.owner_id=new.created_by and coalesce(new.metadata->>'reason','') not in ('scheduled','token_expiring'))
    or not exists(select 1 from public.os_profiles where id=new.owner_id and is_active)
    or coalesce(new.metadata->>'sourceType','') not in ('record','document','hr_employee','hr_leave','hr_promotion')
    or coalesce(new.metadata->>'sourceId','') !~ '^[0-9a-f-]{36}$'
    or coalesce(new.metadata->>'reason','') not in ('assignment','review','approval','blocked','status_change','scheduled','token_expiring')
    or coalesce(new.metadata->>'dedupeKey','')=''
    or jsonb_typeof(new.metadata)<>'object'
    or exists(select 1 from jsonb_each(new.metadata) item where item.key not in ('sourceType','sourceId','reason','readAt','dedupeKey') or jsonb_typeof(item.value)<>'string')
    or (new.status='read' and coalesce(new.metadata->>'readAt','')='') then
    raise exception using errcode='23514',message='NOTIFICATION_INVALID';
  end if;
  return new;
end $$;
-- Every definer entry point is closed by default, then narrowly granted.
do $$ declare f record;t text;begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='os_hr_private' or (n.nspname='public' and (p.proname like 'os_hr_%' or p.proname='os_has_hr_access')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);
 end loop;
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'os_hr_%' or p.proname='os_has_hr_access') and p.proname not in ('os_hr_cron_run','os_hr_sync_holidays') loop
  execute format('grant execute on function %s to authenticated',f.sig);
 end loop;
 foreach t in array array['employees','contracts','leave_credits','leave_requests','leave_promotions','documents','forms','holidays','settings','events'] loop
  execute format('create policy os_hr_active_session on public.os_hr_%I as restrictive for select to authenticated using ((select public.os_hr_session_active()))',t);
 end loop;
end $$;
grant execute on function public.os_hr_cron_run(), public.os_hr_sync_holidays(jsonb) to service_role;
-- No storage.objects policy exposes this bucket; only bounded server-signed URLs.
create function public.os_hr_file_view(p_path text) returns void language plpgsql security definer set search_path='' as $$ declare e uuid;k text:=split_part(p_path,'/',1);target text:=split_part(p_path,'/',2);begin
 if target<>'form' then e:=target::uuid;end if;
 perform os_hr_private.authorize(e,false);
 if not public.os_has_hr_access() and not ((k='leave_proof' and exists(select 1 from public.os_hr_leave_requests where hr_employee_id=e and proof_path=p_path)) or (k='promotion_paper' and exists(select 1 from public.os_hr_leave_promotions where hr_employee_id=e and paper_path=p_path))) then raise exception using errcode='42501',message='HR_ACCESS_REQUIRED';end if;
 perform os_hr_private.file(p_path,k,e);perform os_hr_private.event(e,'file.viewed',jsonb_build_object('purpose',k));end $$;
create function public.os_hr_notification_sources(p_ids uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$ declare result jsonb;own uuid:=public.os_hr_my_employee_id();ops boolean:=public.os_has_hr_access();begin
 if not public.os_hr_session_active() then raise exception using errcode='42501',message='HR_ACCESS_REQUIRED';end if;
 if cardinality(p_ids)>100 then raise exception 'RANGE_REQUIRED';end if;
 select coalesce(jsonb_agg(x),'[]') into result from (
 select e.id,'hr_employee' type,'인사 확인 · '||e.display_name title,'/hr/employees/'||coalesce(e.profile_id,e.id)::text href from public.os_hr_employees e where e.id=any(p_ids) and ops
 union all select r.id,'hr_leave','휴가 '||case r.status when 'pending' then '승인 대기' when 'approved' then '승인' when 'rejected' then '반려' else '취소' end||' · '||e.display_name,case when ops then '/hr/leave' else '/hr/my-leave' end from public.os_hr_leave_requests r join public.os_hr_employees e on e.id=r.hr_employee_id where r.id=any(p_ids) and (ops or e.id=own)
 union all select r.id,'hr_promotion','연차 사용 계획 회신 · '||e.display_name,'/hr/my-leave' from public.os_hr_leave_promotions r join public.os_hr_employees e on e.id=r.hr_employee_id where r.id=any(p_ids) and e.id=own
 ) x;return result;end $$;
revoke all on function public.os_hr_file_view(text),public.os_hr_notification_sources(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.os_hr_file_view(text),public.os_hr_notification_sources(uuid[]) to authenticated;
create function public.os_hr_register_person(p_payload jsonb,p_role text default 'member',p_issued boolean default false) returns uuid language plpgsql security definer set search_path='' as $$ declare result uuid;pid uuid:=nullif(p_payload->>'profile_id','')::uuid;begin
 perform os_hr_private.authorize();if p_issued and not public.os_is_admin() then raise exception using errcode='42501',message='ADMIN_REQUIRED';end if;
 if p_role not in ('member','lead','admin') then raise exception 'INVALID_INPUT';end if;
 result:=public.os_hr_upsert_employee(p_payload,0,null);
 if p_issued then update public.os_profiles set role=p_role::public.os_role,must_change_password=true,password_reset_at=now(),password_reset_by=auth.uid(),onboarding=jsonb_build_object('account',true) where id=pid;perform os_hr_private.event((select id from public.os_hr_employees where profile_id=pid),'account.created','{}',null,pid);end if;
 return result;end $$;
create function public.os_hr_account_input(p_employee uuid) returns jsonb language plpgsql security definer set search_path='' as $$ declare result jsonb;e public.os_hr_employees;begin
 perform os_hr_private.authorize();if not public.os_is_admin() then raise exception using errcode='42501',message='ADMIN_REQUIRED';end if;
 select * into e from public.os_hr_employees where id=p_employee;if not found then raise exception 'HR_NOT_FOUND';end if;
 if e.profile_id is not null then raise exception 'MEMBER_ACCOUNT_EXISTS';end if;
 if e.status='retired' or e.retire_date<(now() at time zone 'Asia/Seoul')::date then raise exception 'RETIRED_ACCOUNT';end if;
 perform os_hr_private.event(e.id,'account.prepared',jsonb_build_object('fields',array['legal_name','email']));
 return jsonb_build_object('email',e.email,'legal_name',e.legal_name,'display_name',e.display_name);end $$;
revoke all on function public.os_hr_register_person(jsonb,text,boolean),public.os_hr_account_input(uuid) from public,anon,authenticated,service_role;
grant execute on function public.os_hr_register_person(jsonb,text,boolean),public.os_hr_account_input(uuid) to authenticated;

-- Classification is an HR decision. A member's existing self-profile policy
-- must not allow a direct UPDATE of the new column.
create function os_hr_private.profile_kind_guard() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.person_kind is distinct from old.person_kind and not public.os_has_hr_access() then raise exception using errcode='42501',message='HR_ACCESS_REQUIRED';end if;
 return new;end $$;
create trigger os_hr_profile_kind_guard before update of person_kind on public.os_profiles for each row execute function os_hr_private.profile_kind_guard();

create function public.os_hr_legacy_preview(p_employee uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$ declare e public.os_hr_employees;b public.os_records;rs jsonb;today date:=(now() at time zone 'Asia/Seoul')::date;p record;begin
 perform os_hr_private.authorize();if not public.os_is_admin() then raise exception using errcode='42501',message='ADMIN_REQUIRED';end if;
 select * into e from public.os_hr_employees where id=p_employee;if not found then raise exception 'HR_NOT_FOUND';end if;
 select * into p from os_hr_private.period(e.hire_date,today);
 select * into b from public.os_records where record_type='leave_balance' and archived_at is null and coalesce(metadata->>'memberId',assignee_id::text)=e.profile_id::text order by updated_at desc,id desc limit 1;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'version',r.version,'start',(r.starts_at at time zone 'Asia/Seoul')::date,'end',(r.ends_at at time zone 'Asia/Seoul')::date,'type',r.metadata->>'leaveType','days',coalesce((r.metadata->>'days')::numeric,r.metric_current),'status',r.status,'imported',exists(select 1 from public.os_hr_leave_requests n where n.legacy_record_id=r.id)) order by r.starts_at),'[]') into rs from public.os_records r where r.record_type='leave_request' and r.archived_at is null and coalesce(r.metadata->>'memberId',r.assignee_id::text)=e.profile_id::text and r.status in ('pending','approved');
 return jsonb_build_object('employee',e.id,'version',e.version,'balanceId',b.id,'balanceVersion',b.version,'oldBalance',b.metric_current,'newBalance',os_hr_private.balance(e.id,today,today),'periodStart',p.start_date,'imported',exists(select 1 from public.os_hr_events where hr_employee_id=e.id and action='legacy.imported' and detail->>'periodStart'=p.start_date::text),'requests',rs);end $$;
create function public.os_hr_import_legacy(p_employee uuid,p_version int,p_balance uuid,p_balance_version int,p_requests jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ declare e public.os_hr_employees;b public.os_records;r public.os_records;item jsonb;today date:=(now() at time zone 'Asia/Seoul')::date;p record;rp record;st date;en date;t text;ded boolean;ds numeric;delta numeric;total int:=0;begin
 perform os_hr_private.authorize();if not public.os_is_admin() then raise exception using errcode='42501',message='ADMIN_REQUIRED';end if;
 select * into e from public.os_hr_employees where id=p_employee for update;if not found then raise exception 'HR_NOT_FOUND';end if;
 if e.version is distinct from p_version then raise exception 'VERSION_CONFLICT';end if;
 if e.profile_id is null or not exists(select 1 from public.os_profiles where id=e.profile_id and person_kind='employee' and not is_shared_account) then raise exception 'NOT_EMPLOYEE';end if;
 select * into p from os_hr_private.period(e.hire_date,today);
 if exists(select 1 from public.os_hr_events where hr_employee_id=e.id and action='legacy.imported' and detail->>'periodStart'=p.start_date::text) then raise exception 'ALREADY_IMPORTED';end if;
 if jsonb_typeof(p_requests)<>'array' or jsonb_array_length(p_requests)>500 then raise exception 'INVALID_INPUT';end if;
 if p_balance is not null then
  select * into b from public.os_records where id=p_balance and record_type='leave_balance' and archived_at is null and coalesce(metadata->>'memberId',assignee_id::text)=e.profile_id::text for update;
  if not found or b.version is distinct from p_balance_version then raise exception 'VERSION_CONFLICT';end if;
  if b.metric_current is null or abs(b.metric_current)>999 or mod(b.metric_current,0.5)<>0 then raise exception 'INVALID_DAYS';end if;
 end if;
 for item in select * from jsonb_array_elements(p_requests) loop
  select * into r from public.os_records where id=(item->>'id')::uuid and record_type='leave_request' and archived_at is null and coalesce(metadata->>'memberId',assignee_id::text)=e.profile_id::text for update;
  if not found or r.version is distinct from (item->>'version')::int or r.status not in ('pending','approved') then raise exception 'VERSION_CONFLICT';end if;
  if exists(select 1 from public.os_hr_leave_requests where legacy_record_id=r.id) then continue;end if;
  t:=item->>'type';ded:=t in ('annual','half_am','half_pm');st:=(r.starts_at at time zone 'Asia/Seoul')::date;en:=(r.ends_at at time zone 'Asia/Seoul')::date;
  if t is null or t not in ('annual','half_am','half_pm','sick','family_event','public_duty','unpaid','other') then raise exception 'INVALID_INPUT';end if;
  if st is null or en is null or en<st or en-st>366 or st<e.hire_date or e.retire_date is not null and en>e.retire_date or t in ('half_am','half_pm') and en<>st then raise exception 'INVALID_DATES';end if;
  select * into rp from os_hr_private.period(e.hire_date,st);if ded and en>rp.end_date then raise exception 'CROSSES_PERIOD';end if;
  if exists(select 1 from public.os_hr_leave_requests where hr_employee_id=e.id and status in ('pending','approved') and start_date<=en and end_date>=st) then raise exception 'OVERLAP_SELF';end if;
  ds:=os_hr_private.workdays(st,en);if t in ('half_am','half_pm') and ds>0 then ds:=0.5;end if;if ds<=0 then raise exception 'NO_WORKDAYS';end if;
  insert into public.os_hr_leave_requests(hr_employee_id,leave_type,start_date,end_date,days,deducts,reason,status,requested_by,requested_at,decided_by,decided_at,legacy_record_id) values(e.id,t,st,en,ds,ded,left(coalesce(r.description,''),500),r.status,e.profile_id,coalesce(r.created_at,now()),case when r.status='approved' then auth.uid() end,case when r.status='approved' then r.updated_at end,r.id);total:=total+1;
 end loop;
 if p_balance is not null then
  delta:=b.metric_current-os_hr_private.balance(e.id,today,today);
  if delta<>0 then perform public.os_hr_add_credit(e.id,delta,'기존 OS 잔여 이관 '||today::text,'opening');end if;
 end if;
 perform os_hr_private.event(e.id,'legacy.imported',jsonb_build_object('periodStart',p.start_date,'requests',total,'opening',coalesce(delta,0)),'관리자 검토 후 기존 자료 이관');
 return jsonb_build_object('requests',total,'opening',coalesce(delta,0));end $$;
create function public.os_hr_legacy_person(p_profile uuid) returns jsonb language plpgsql security definer set search_path='' as $$ declare result jsonb;begin
 perform os_hr_private.authorize();if not public.os_is_admin() then raise exception using errcode='42501',message='ADMIN_REQUIRED';end if;
 if to_regclass('public.erp_employees') is null then return null;end if;
 execute 'select jsonb_build_object(''legal_name'',e.name,''hire_date'',e.join_date,''birth_date'',e.birth_date,''address'',e.address,''phone'',e.phone,''emergency_contact'',e.emergency_contact) from public.erp_employees e join public.os_profiles p on p.id=$1 and (p.employee_id=e.id or (e.email<>'''' and lower(e.email)=lower(p.email))) order by (p.employee_id=e.id) desc nulls last,e.id limit 1' into result using p_profile;
 perform os_hr_private.event(null,'legacy.viewed',jsonb_build_object('fields',array['legal_name','hire_date','birth_date','address','phone','emergency_contact']),null,p_profile);return result;end $$;
revoke all on function public.os_hr_legacy_preview(uuid),public.os_hr_import_legacy(uuid,int,uuid,int,jsonb),public.os_hr_legacy_person(uuid) from public,anon,authenticated,service_role;
grant execute on function public.os_hr_legacy_preview(uuid),public.os_hr_import_legacy(uuid,int,uuid,int,jsonb),public.os_hr_legacy_person(uuid) to authenticated;
revoke all on all functions in schema os_hr_private from public,anon,authenticated,service_role;

create function public.os_hr_owner_active(p_profile uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.os_profiles where id=p_profile and is_active) and not exists(select 1 from public.os_hr_employees where profile_id=p_profile and (status='retired' or retire_date<(now() at time zone 'Asia/Seoul')::date))
$$;
revoke all on function public.os_hr_owner_active(uuid) from public,anon,authenticated,service_role;
grant execute on function public.os_hr_owner_active(uuid) to service_role;

-- The new HR role boundary must not be grantable by an ordinary self-profile write.
create function os_hr_private.access_guard() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.finance_access is distinct from old.finance_access and not public.os_is_admin() and coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='ADMIN_REQUIRED';end if;
 return new;end $$;
create trigger os_hr_access_guard before update of finance_access on public.os_profiles for each row execute function os_hr_private.access_guard();
revoke all on all functions in schema os_hr_private from public,anon,authenticated,service_role;
