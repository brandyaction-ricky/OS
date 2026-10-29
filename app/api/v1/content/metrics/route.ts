import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { validDay } from "@/lib/team/dates";
import type { OsRecord } from "@/lib/record-types";

export const dynamic = "force-dynamic";

/** What the performance screens use from content_metric for [from, to] (UTC days, inclusive): the latest
 *  cumulative snapshot per video, every daily row and channel snapshots. Without dates: all history. */
export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const url = new URL(request.url);
    const from = url.searchParams.get("from"), to = url.searchParams.get("to");
    if ((from && !validDay(from)) || (to && !validDay(to)) || (from && to && from > to)) throw new ApiError(400, "INVALID_DATE_RANGE", "날짜 범위를 확인해 주세요.");
    const end = new Date(`${to ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    const records: OsRecord[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await actor.supabase.rpc("os_content_metric_window", { p_from: `${from ?? "1970-01-01"}T00:00:00Z`, p_to: end.toISOString() })
        .order("updated_at", { ascending: false }).order("id", { ascending: true }).range(offset, offset + 999);
      if (error) throw new ApiError(503, "METRIC_WINDOW_FAILED", "성과 기록을 불러오지 못했습니다.");
      records.push(...(data ?? []) as OsRecord[]);
      if ((data?.length ?? 0) < 1000) break;
    }
    return NextResponse.json({ records }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
