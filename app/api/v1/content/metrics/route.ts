import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { withObservedOrigin } from "@/lib/content-metrics";
import { validDay } from "@/lib/team/dates";
import type { OsRecord } from "@/lib/record-types";

export const dynamic = "force-dynamic";

/** What the performance screens use from content_metric for [from, to] (UTC days, inclusive): the latest
 *  cumulative snapshot per video and every daily row — or, with ?snapshots=1, the channel snapshots (D1 · D7 · D28)
 *  of posts published in those days. Without dates: all history. */
export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const url = new URL(request.url);
    const from = url.searchParams.get("from"), to = url.searchParams.get("to"), snapshots = url.searchParams.get("snapshots") === "1";
    if ((from && !validDay(from)) || (to && !validDay(to)) || (from && to && from > to)) throw new ApiError(400, "INVALID_DATE_RANGE", "날짜 범위를 확인해 주세요.");
    const end = new Date(`${to ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    const window = { p_from: `${from ?? "1970-01-01"}T00:00:00Z`, p_to: end.toISOString() };
    const pages = async (read: (offset: number) => PromiseLike<{ data: unknown[] | null; error: { code?: string } | null }>) => {
      const rows: OsRecord[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await read(offset);
        if (error) return { rows, error };
        rows.push(...(data ?? []) as OsRecord[]);
        if ((data?.length ?? 0) < 1000) return { rows, error: null };
      }
    };
    // v2 leaves the channel snapshots out of the window (they made one 30-day read 22k rows); until it is in the database
    // (PGRST202: function not found) v1 answers and the same split happens here.
    let { rows: records, error } = await pages((offset) => actor.supabase.rpc("os_content_metric_window_v2", { ...window, p_snapshots: snapshots })
      .order("updated_at", { ascending: false }).order("id", { ascending: true }).range(offset, offset + 999));
    if (error?.code === "PGRST202") {
      ({ rows: records, error } = await pages((offset) => actor.supabase.rpc("os_content_metric_window", window)
        .order("updated_at", { ascending: false }).order("id", { ascending: true }).range(offset, offset + 999)));
      const day = (value: unknown) => String(value ?? "").slice(0, 10), last = end.toISOString().slice(0, 10);
      records = records.filter((record) => (record.metadata?.channelSnapshotVersion === 1) === snapshots
        && (!snapshots || (day(record.metadata?.publishedAt) >= window.p_from.slice(0, 10) && day(record.metadata?.publishedAt) < last)));
    }
    if (error) throw new ApiError(503, "METRIC_WINDOW_FAILED", "성과 기록을 불러오지 못했습니다.");
    // Observer rows saved before they carried `origin`: only our connected channels count as 우리 콘텐츠.
    const { data: own, error: ownError } = await createServiceSupabase().from("os_youtube_connections").select("channel_id");
    if (ownError) throw new ApiError(503, "METRIC_WINDOW_FAILED", "성과 기록을 불러오지 못했습니다.");
    const ownChannelIds = new Set((own ?? []).map((row) => String(row.channel_id)));
    return NextResponse.json({ records: records.map((record) => withObservedOrigin(record, ownChannelIds)) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
