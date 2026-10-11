export interface TeamAbsence {
  name: string;
  start: string;
  end: string;
  part: "day" | "am" | "pm";
}

export function publicAbsences(
  requests: Array<{ hr_employee_id: string; start_date: string; end_date: string; leave_type: string }>,
  employees: Array<{ id: string; profile_id: string | null; display_name: string }>,
  profiles: Array<{ id: string; display_name?: string | null; is_active: boolean; is_shared_account: boolean | null; member_kind: string | null }>,
): TeamAbsence[] {
  const visible = new Map(profiles.filter(profile => profile.is_active && !profile.is_shared_account && profile.member_kind !== "partner").map(profile => [profile.id, profile.display_name]));
  const names = new Map(employees.filter(employee => employee.profile_id && visible.has(employee.profile_id)).map(employee => [employee.id, visible.get(employee.profile_id!) || employee.display_name]));
  return requests.flatMap(request => {
    const name = names.get(request.hr_employee_id);
    return name ? [{ name, start: request.start_date, end: request.end_date, part: request.leave_type === "half_am" ? "am" as const : request.leave_type === "half_pm" ? "pm" as const : "day" as const }] : [];
  });
}
