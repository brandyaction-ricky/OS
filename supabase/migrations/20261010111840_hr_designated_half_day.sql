-- Preserve existing notices; only future designation notices use this field.
alter table public.os_hr_leave_promotions
  add column designated_half_day text
  check (designated_half_day in ('am', 'pm'));

create function public.os_hr_send_promotion_v2(
  p_employee uuid, p_step text, p_days numeric, p_dates date[],
  p_channel text, p_body text, p_half_day text default null, p_paper text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  e public.os_hr_employees; p record; one public.os_hr_leave_promotions;
  start1 date; end1 date; due2 date;
  today date := (now() at time zone 'Asia/Seoul')::date;
  n numeric; result uuid; d date; extra boolean;
begin
  perform os_hr_private.authorize();
  select * into e from public.os_hr_employees where id = p_employee for update;
  if not found then raise exception 'HR_NOT_FOUND'; end if;
  if e.status = 'retired' or e.hire_date > today then raise exception 'NOT_ELIGIBLE'; end if;
  select * into p from os_hr_private.period(e.hire_date, today);
  extra := p_step in ('notice_1_extra', 'designation_2_extra');
  if p_step not in ('notice_1', 'designation_2', 'notice_1_extra', 'designation_2_extra', 'refusal')
    or (extra and not p.first_year) then raise exception 'INVALID_INPUT'; end if;
  start1 := ((p.end_date + 1) - make_interval(months => case when extra then 1 when p.first_year then 3 else 6 end))::date;
  end1 := start1 + case when extra then 4 else 9 end;
  due2 := case when extra then p.end_date - 10 else ((p.end_date + 1) - make_interval(months => case when p.first_year then 1 else 2 end))::date - 1 end;
  n := greatest(0, os_hr_private.balance(e.id, today, today));
  if extra then
    select * into one from public.os_hr_leave_promotions
      where hr_employee_id = e.id and period_start = p.start_date and step = 'notice_1';
    if not found then raise exception 'NOT_IN_WINDOW'; end if;
    select count(*) into n from os_hr_private.accruals(e.hire_date, p.end_date) a
      where a.kind = 'accrual_monthly' and a.entry_date > (one.sent_at at time zone 'Asia/Seoul')::date;
  end if;
  if p_step in ('notice_1', 'notice_1_extra') then
    if today not between start1 and end1 or n <= 0 then raise exception 'NOT_IN_WINDOW'; end if;
    if cardinality(coalesce(p_dates, '{}'::date[])) <> 0 or p_half_day is not null then raise exception 'DATES_REQUIRED'; end if;
  else
    select * into one from public.os_hr_leave_promotions
      where hr_employee_id = e.id and period_start = p.start_date
        and step = case when extra then 'notice_1_extra' else 'notice_1' end;
    if not found or today > due2 or (one.reply_at is null and today <= (one.sent_at at time zone 'Asia/Seoul')::date + 10)
      then raise exception 'NOT_IN_WINDOW'; end if;
    n := greatest(0, n - coalesce(one.reply_days, 0));
    if n <= 0 or cardinality(coalesce(p_dates, '{}'::date[])) <> ceil(n)
      or cardinality(coalesce(p_dates, '{}'::date[])) > 366
      or cardinality(coalesce(p_dates, '{}'::date[])) <> (select count(distinct x) from unnest(p_dates) x)
      then raise exception 'DATES_REQUIRED'; end if;
    if (mod(n, 1) <> 0 and (p_half_day is null or p_half_day not in ('am', 'pm')))
      or (mod(n, 1) = 0 and p_half_day is not null)
      then raise exception 'DATES_REQUIRED'; end if;
    foreach d in array p_dates loop
      if d < today or d > p.end_date or os_hr_private.workdays(d, d) = 0 then raise exception 'INVALID_DATES'; end if;
    end loop;
  end if;
  if p_days is distinct from n then raise exception 'VERSION_CONFLICT'; end if;
  if p_channel not in ('os_email', 'paper') or length(btrim(p_body)) not between 1 and 16000 then raise exception 'INVALID_INPUT'; end if;
  if p_channel = 'paper' and nullif(p_paper, '') is null then raise exception 'PROOF_REQUIRED'; end if;
  perform os_hr_private.file(p_paper, 'promotion_paper', e.id);
  insert into public.os_hr_leave_promotions(
    hr_employee_id, period_start, period_end, step, due_date,
    sent_by, channel, days, designated_dates, designated_half_day, body, paper_path
  ) values (
    e.id, p.start_date, p.end_date, p_step,
    case when p_step like 'notice_%' then end1 else due2 end,
    auth.uid(), p_channel, n, coalesce(p_dates, '{}'::date[]), p_half_day, p_body, p_paper
  ) returning id into result;
  perform os_hr_private.event(e.id, 'promotion.sent', jsonb_build_object(
    'promotion', result, 'step', p_step, 'channel', p_channel, 'days', n,
    'halfDay', p_half_day
  ));
  return result;
exception when unique_violation then raise exception 'ALREADY_SENT';
end $$;

-- Keep the existing RPC contract, but reject excess/ambiguous designation days.
create or replace function public.os_hr_send_promotion(
  p_employee uuid, p_step text, p_days numeric, p_dates date[],
  p_channel text, p_body text, p_paper text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  return public.os_hr_send_promotion_v2(
    p_employee, p_step, p_days, p_dates, p_channel, p_body, null, p_paper
  );
end $$;

revoke all on function public.os_hr_send_promotion_v2(uuid,text,numeric,date[],text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.os_hr_send_promotion_v2(uuid,text,numeric,date[],text,text,text,text)
  to authenticated;
