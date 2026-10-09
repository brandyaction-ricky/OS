-- Keep operator and own-record reads in one SELECT policy per HR table.
-- These predicates are the OR of the two policies installed by the initial HR migration.
alter policy os_hr_operator_read on public.os_hr_leave_requests
  using ((select public.os_has_hr_access()) or hr_employee_id = (select public.os_hr_my_employee_id()));
drop policy os_hr_own_requests on public.os_hr_leave_requests;

alter policy os_hr_operator_read on public.os_hr_leave_credits
  using ((select public.os_has_hr_access()) or hr_employee_id = (select public.os_hr_my_employee_id()));
drop policy os_hr_own_credits on public.os_hr_leave_credits;

alter policy os_hr_operator_read on public.os_hr_leave_promotions
  using ((select public.os_has_hr_access()) or hr_employee_id = (select public.os_hr_my_employee_id()));
drop policy os_hr_own_promotions on public.os_hr_leave_promotions;

-- HR operator access already requires an active session. The original policies
-- therefore allowed every active session to read the holiday calendar.
alter policy os_hr_operator_read on public.os_hr_holidays
  using ((select public.os_hr_session_active()));
drop policy os_hr_holidays_read on public.os_hr_holidays;
