import { ApiError } from "@/lib/http";
import { withObservedOrigin } from "@/lib/content-metrics";
import { createServiceSupabase } from "@/lib/supabase/server";
import { validDay } from "@/lib/team/dates";
import type { OsRecord } from "@/lib/record-types";
import type { RequestActor } from "./auth";

/** [from, to] as UTC days, both ends kept, for the metric functions (to + 1 day, exclusive). No dates = all history. */
export function metricRange(from: string | null, to: string | null) {
  if ((from && !validDay(from)) || (to && !validDay(to)) || (from && to && from > to)) throw new ApiError(400, "INVALID_DATE_RANGE", "날짜 범위를 확인해 주세요.");
  const end = new Date(`${to ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { p_from: `${from ?? "1970-01-01"}T00:00:00Z`, p_to: end.toISOString() };
}

type Read = (offset: number) => PromiseLike<{ data: unknown[] | null; error: { code?: string } | null }>;
async function pages(read: Read) {
  const rows: OsRecord[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await read(offset);
    if (error) return { rows, error };
    rows.push(...(data ?? []) as OsRecord[]);
    if ((data?.length ?? 0) < 1000) return { rows, error: null };
  }
}

/** The window rows (latest cumulative per video + every daily row), or with `snapshots` the D1 · D7 · D28 rows of posts
 *  published in the window. v2 leaves the channel snapshots out (they made one 30-day read 22k rows); until it is in the
 *  database (PGRST202: function not found) v1 answers and the same split happens here. */
export async function readMetricWindow(actor: RequestActor, window: { p_from: string; p_to: string }, snapshots: boolean) {
  let { rows: records, error } = await pages((offset) => actor.supabase.rpc("os_content_metric_window_v2", { ...window, p_snapshots: snapshots })
    .order("updated_at", { ascending: false }).order("id", { ascending: true }).range(offset, offset + 999));
  if (error?.code === "PGRST202") {
    ({ rows: records, error } = await pages((offset) => actor.supabase.rpc("os_content_metric_window", window)
      .order("updated_at", { ascending: false }).order("id", { ascending: true }).range(offset, offset + 999)));
    const day = (value: unknown) => String(value ?? "").slice(0, 10), last = window.p_to.slice(0, 10);
    records = records.filter((record) => (record.metadata?.channelSnapshotVersion === 1) === snapshots
      && (!snapshots || (day(record.metadata?.publishedAt) >= window.p_from.slice(0, 10) && day(record.metadata?.publishedAt) < last)));
  }
  if (error) throw new ApiError(503, "METRIC_WINDOW_FAILED", "성과 기록을 불러오지 못했습니다.");
  return records;
}

/** Observer rows saved before they carried `origin`: only our connected channels count as 우리 콘텐츠. */
export async function withOrigins(records: OsRecord[]) {
  if (!records.some((record) => record.metadata?.dataSource === "youtube_data_api" && !record.metadata?.origin)) return records;
  const { data: own, error } = await createServiceSupabase().from("os_youtube_connections").select("channel_id");
  if (error) throw new ApiError(503, "METRIC_WINDOW_FAILED", "성과 기록을 불러오지 못했습니다.");
  const ownChannelIds = new Set((own ?? []).map((row) => String(row.channel_id)));
  return records.map((record) => withObservedOrigin(record, ownChannelIds));
}
