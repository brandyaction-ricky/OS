import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { hrWorkspaceEnabled } from "@/lib/hr/gate";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { publicAbsences } from "@/lib/team/absence";
import { validDay } from "@/lib/team/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    if (actor.type !== "user") throw new ApiError(403, "USER_REQUIRED", "팀 일정은 구성원만 볼 수 있습니다.");
    if (!hrWorkspaceEnabled()) return NextResponse.json({ absences: [] });
    const url = new URL(request.url);
    const from = url.searchParams.get("from"), to = url.searchParams.get("to");
    if (!validDay(from) || !validDay(to) || from! >= to! || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 93 * 86400000)
      throw new ApiError(400, "INVALID_DATE_RANGE", "조회 기간은 93일 이내로 선택해 주세요.");
    const service = createServiceSupabase();
    // Read only the columns needed for the team calendar; reasons and proofs never enter the response.
    const requests: Array<{hr_employee_id:string;start_date:string;end_date:string;leave_type:string}> = [];
    for (let offset = 0; ; offset += 500) {
      const leave = await service.from("os_hr_leave_requests")
        .select("hr_employee_id,start_date,end_date,leave_type")
        .eq("status", "approved").lt("start_date", to!).gte("end_date", from!).order("id").range(offset, offset + 499);
      if (leave.error) throw new ApiError(503, "ABSENCE_READ_FAILED", "부재 일정을 불러오지 못했습니다.");
      requests.push(...(leave.data ?? []));
      if (!leave.data || leave.data.length < 500) break;
    }
    const ids = [...new Set(requests.map(row => row.hr_employee_id))];
    if (!ids.length) return NextResponse.json({ absences: [] });
    const employees = await service.from("os_hr_employees").select("id,profile_id,display_name").in("id", ids);
    if (employees.error) throw new ApiError(503, "ABSENCE_READ_FAILED", "부재 일정을 불러오지 못했습니다.");
    const profileIds = [...new Set((employees.data ?? []).map(row => row.profile_id).filter((id): id is string => !!id))];
    if (!profileIds.length) return NextResponse.json({ absences: [] });
    const profiles = await service.from("os_profiles").select("id,display_name,is_active,is_shared_account,member_kind").in("id", profileIds);
    if (profiles.error) throw new ApiError(503, "ABSENCE_READ_FAILED", "부재 일정을 불러오지 못했습니다.");
    return NextResponse.json({ absences: publicAbsences(requests, employees.data ?? [], profiles.data ?? []) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
