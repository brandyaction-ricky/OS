import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { readVideoSales } from "@/lib/server/myin-sales";
import { validDay } from "@/lib/team/dates";

export const dynamic = "force-dynamic";

/** 마이인 영상별 매출 for [from, to] (KST paid days, both ends kept, at most 92 days): counts and won per video, no person. */
export async function GET(request: Request) {
  try {
    await authenticateRequest(request);
    const url = new URL(request.url), from = url.searchParams.get("from") ?? "", to = url.searchParams.get("to") ?? "";
    if (!validDay(from) || !validDay(to) || from > to) throw new ApiError(400, "INVALID_DATE_RANGE", "날짜 범위를 확인해 주세요.");
    if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 >= 92) throw new ApiError(400, "RANGE_TOO_LONG", "영상별 매출은 92일까지 볼 수 있어요.");
    return NextResponse.json(await readVideoSales(from, to, url.searchParams.get("fresh") === "1"), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
