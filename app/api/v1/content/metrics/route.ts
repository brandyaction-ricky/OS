import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { metricRange, readMetricWindow, withOrigins } from "@/lib/server/metric-window";

export const dynamic = "force-dynamic";

/** What the performance screens use from content_metric for [from, to] (UTC days, inclusive): the latest
 *  cumulative snapshot per video and every daily row — or, with ?snapshots=1, the channel snapshots (D1 · D7 · D28)
 *  of posts published in those days. Without dates: all history. 영상 성과 itself reads /summary. */
export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const url = new URL(request.url);
    const records = await readMetricWindow(actor, metricRange(url.searchParams.get("from"), url.searchParams.get("to")), url.searchParams.get("snapshots") === "1");
    return NextResponse.json({ records: await withOrigins(records) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
