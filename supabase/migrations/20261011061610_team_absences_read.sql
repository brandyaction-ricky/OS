-- Team calendar may show only an approved absence's name, dates and day part.
-- HR source tables remain inaccessible to service_role and ordinary members.
create function public.os_team_absences(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.os_hr_session_active() then
    raise exception 'OS_ACTIVE_USER_REQUIRED' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from >= p_to or p_to - p_from > 93 then
    raise exception 'INVALID_DATE_RANGE' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'name', coalesce(nullif(p.display_name, ''), e.display_name),
    'start', r.start_date,
    'end', r.end_date,
    'part', case r.leave_type when 'half_am' then 'am' when 'half_pm' then 'pm' else 'day' end
  ) order by r.start_date, r.end_date, p.display_name, r.id), '[]'::jsonb)
  into result
  from public.os_hr_leave_requests r
  join public.os_hr_employees e on e.id = r.hr_employee_id
  join public.os_profiles p on p.id = e.profile_id
  where r.status = 'approved'
    and r.start_date < p_to and r.end_date >= p_from
    and p.is_active and not coalesce(p.is_shared_account, false)
    and p.member_kind is distinct from 'partner';
  return result;
end $$;

revoke all on function public.os_team_absences(date, date) from public, anon, authenticated, service_role;
grant execute on function public.os_team_absences(date, date) to authenticated;
