import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { safeSecretMatch } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { hrWorkspaceEnabled } from "@/lib/hr/gate";
import { todayKst, weekday } from "@/lib/hr/domain";
import { fetchHolidayYear } from "@/lib/server/hr-holidays";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET || "",
      received =
        request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    if (!secret || !safeSecretMatch(received, secret))
      throw new ApiError(
        401,
        "INVALID_CRON_SECRET",
        "예약 작업 인증에 실패했습니다.",
      );
    if (!hrWorkspaceEnabled())
      return NextResponse.json({ skipped: "hr_disabled" });
    const service = createServiceSupabase(),
      today = todayKst();
    let holidays: unknown = { skipped: "not_configured" };
    if (process.env.HOLIDAY_API_KEY && weekday(today) === 1) {
      try {
        const year = Number(today.slice(0, 4));
        const rows = (
          await Promise.all([
            fetchHolidayYear(year, process.env.HOLIDAY_API_KEY),
            fetchHolidayYear(year + 1, process.env.HOLIDAY_API_KEY),
          ])
        ).flat();
        const { error } = await service.rpc("os_hr_sync_holidays", {
          p_rows: rows,
        });
        if (error) throw new Error("SYNC_FAILED");
        holidays = { updated: rows.length };
      } catch {
        holidays = { error: "HOLIDAY_SYNC_FAILED" };
      }
    } else if (process.env.HOLIDAY_API_KEY)
      holidays = { skipped: "weekly_monday" };
    const { data, error } = await service.rpc("os_hr_cron_run");
    if (error)
      throw new ApiError(
        503,
        "HR_CRON_FAILED",
        "인사 예약 처리를 완료하지 못했습니다.",
      );
    return NextResponse.json(
      { ok: !(holidays as { error?: string }).error, result: data, holidays },
      { status: (holidays as { error?: string }).error ? 503 : 200 },
    );
  } catch (error) {
    return apiErrorResponse(
      error instanceof ApiError
        ? error
        : new ApiError(
            503,
            "HR_CRON_FAILED",
            "인사 예약 처리를 완료하지 못했습니다.",
          ),
    );
  }
}
