import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { hrWorkspaceEnabled } from "@/lib/hr/gate";
import { authenticateRequest } from "@/lib/server/auth";
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
    // HR tables deliberately deny broad service-role reads. The authenticated,
    // bounded RPC returns only the public calendar projection.
    const { data, error } = await actor.supabase.rpc("os_team_absences", { p_from: from, p_to: to });
    if (error || !Array.isArray(data)) throw new ApiError(503, "ABSENCE_READ_FAILED", "부재 일정을 불러오지 못했습니다.");
    return NextResponse.json({ absences: data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
