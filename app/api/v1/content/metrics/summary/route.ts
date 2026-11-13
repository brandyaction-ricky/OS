import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { metricRange, readMetricWindow, withOrigins } from "@/lib/server/metric-window";
import { ANALYTICS_DAILY, summarizeDayRows, type MetricSummary } from "@/lib/content-metric-summary";

export const dynamic = "force-dynamic";

/** 영상 성과 for [from, to] in one small answer: YouTube Analytics day rows added up per day and per video, plus the other metric
 *  rows of the window (hourly tracked-channel rows only with ?observed=1). Until os_content_metric_summary is in the database
 *  (PGRST202) the window rows are read and added up here the same way. */
export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const url = new URL(request.url), observed = url.searchParams.get("observed") === "1";
    const window = metricRange(url.searchParams.get("from"), url.searchParams.get("to"));
    const { data, error } = await actor.supabase.rpc("os_content_metric_summary", { ...window, p_observed: observed });
    let summary: MetricSummary;
    if (!error) summary = data as MetricSummary;
    else if (error.code === "PGRST202") {
      const rows = await readMetricWindow(actor, window, false);
      summary = { ...summarizeDayRows(rows.filter((row) => row.metadata?.dataSource === ANALYTICS_DAILY)),
        rows: rows.filter((row) => row.metadata?.dataSource !== ANALYTICS_DAILY && (observed || row.metadata?.dataSource !== "youtube_data_api")) };
    } else throw new ApiError(503, "METRIC_SUMMARY_FAILED", "성과 기록을 불러오지 못했습니다.");
    return NextResponse.json({ ...summary, rows: await withOrigins(summary.rows ?? []) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
