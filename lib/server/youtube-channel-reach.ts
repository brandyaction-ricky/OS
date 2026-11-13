import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { parseReachCsv, reachPercent, ytFormat, type ReachDay } from "@/lib/youtube-channel-analytics";
import { youtubeAnalyticsConnected } from "./channel-metrics";
import { DAILY, channelUploads, ytDailyId } from "./youtube-channel-analytics";
import { getYoutubeAccessToken, type YoutubeStoredConnection } from "./youtube-oauth";

// 노출 · 클릭률 (2026-11-13): YouTube Analytics has no thumbnail impressions, so each connected channel gets one YouTube Reporting job
// for the Reach report (channel_reach_basic_a1). YouTube writes one report per day about two days late, plus the 30 days before the
// job on its first days. Each run reads the reports created in the last few days and puts impressions and CTR on the same day rows
// the Analytics job writes (a day with impressions but no other activity gets its own row). Read-only to YouTube; same scope.
const API = "https://youtubereporting.googleapis.com/v1", REPORT_TYPE = "channel_reach_basic_a1", LOOKBACK_DAYS = 4;

async function reporting<T>(url: string, token: string, init?: RequestInit, csv = false): Promise<T> {
  const response = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, ...(init?.body ? { "content-type": "application/json" } : {}) }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (response.ok) return (csv ? await response.text() : await response.json().catch(() => ({}))) as T;
  const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
  throw new ApiError(response.status === 403 ? 409 : 502, response.status === 403 ? "YOUTUBE_ANALYTICS_SCOPE_REQUIRED" : "YOUTUBE_REPORTING_FAILED",
    response.status === 403 ? "YouTube 성과 권한을 확인하고 채널을 다시 연결해 주세요." : "YouTube 노출 보고서를 불러오지 못했습니다.", body.error?.message);
}

type Report = { id: string; createTime: string; downloadUrl: string };
const COLUMNS = ["id", "record_type", "title", "status", "owner_id", "created_by", "source_url", "brand", "team", "stage", "description", "metric_current", "metric_unit", "starts_at"] as const;
export async function syncChannelReach(now = new Date(), budgetMs = 240_000) {
  const started = Date.now(), db = createServiceSupabase(), measuredAt = now.toISOString();
  const { data, error } = await db.from("os_youtube_connections").select("*");
  if (error) throw new ApiError(503, "YOUTUBE_CONNECTIONS_UNAVAILABLE", "YouTube 연결을 읽지 못했습니다.");
  const counts = { channels: 0, jobsCreated: 0, reports: 0, days: 0, newRows: 0, reconnectRequired: 0, laterForTime: 0, failures: 0 };
  for (const connection of (data ?? []) as YoutubeStoredConnection[]) {
    if (!youtubeAnalyticsConnected(connection)) { counts.reconnectRequired++; continue; }
    if (Date.now() - started > budgetMs) { counts.laterForTime++; continue; }
    try {
      const token = await getYoutubeAccessToken(connection.owner_id, connection.channel_id);
      counts.channels++;
      const { jobs = [] } = await reporting<{ jobs?: { id: string; reportTypeId: string }[] }>(`${API}/jobs`, token);
      const job = jobs.find((item) => item.reportTypeId === REPORT_TYPE);
      if (!job) { await reporting(`${API}/jobs`, token, { method: "POST", body: JSON.stringify({ reportTypeId: REPORT_TYPE, name: "Brandy OS 노출 · 클릭률" }) }); counts.jobsCreated++; continue; }
      const reports: Report[] = [];
      const createdAfter = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();
      for (let page = "", n = 0; n < 20; n++) {
        const list = await reporting<{ reports?: Report[]; nextPageToken?: string }>(`${API}/jobs/${job.id}/reports?${new URLSearchParams({ createdAfter, ...(page ? { pageToken: page } : {}) })}`, token);
        reports.push(...(list.reports ?? []));
        if (!list.nextPageToken) break;
        page = list.nextPageToken;
      }
      // A revised report for the same day comes later; reading oldest first lets the newest win.
      const days = new Map<string, ReachDay>();
      const parsed: ReachDay[] = [];
      for (const report of reports.sort((a, b) => a.createTime.localeCompare(b.createTime))) {
        if (Date.now() - started > budgetMs) { counts.laterForTime++; break; }
        parsed.push(...parseReachCsv(await reporting<string>(report.downloadUrl, token, undefined, true)));
        counts.reports++;
      }
      for (const row of reachPercent(parsed)) days.set(`${row.video}|${row.day}`, row);
      const rows = [...days.values()].filter((row) => row.impressions > 0);
      const ids = rows.map((row) => ytDailyId(connection.channel_id, row.video, row.day));
      const existing = new Map<string, Record<string, unknown>>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data: found, error: readError } = await db.from("os_records").select("*").in("id", ids.slice(i, i + 200));
        if (readError) throw new Error("day rows read failed");
        for (const row of found ?? []) existing.set(String(row.id), row);
      }
      const uploads = ids.some((id) => !existing.has(id)) ? new Map((await channelUploads(token, connection.channel_id)).map((video) => [video.id, video])) : new Map();
      const writes = rows.flatMap((row, index) => {
        const id = ids[index], reach = { impressions: row.impressions, ctr: row.ctr }, kept = existing.get(id);
        // Only the columns the Analytics job itself writes, so an upsert never touches anything else on the row.
        if (kept) return [{ ...Object.fromEntries(COLUMNS.map((column) => [column, kept[column]])), updated_by: connection.owner_id, metadata: { ...(kept.metadata as Record<string, unknown>), ...reach } }];
        const video = uploads.get(row.video);
        if (!video) return [];
        counts.newRows++;
        return [{ id, record_type: "content_metric", title: video.title, status: "done", owner_id: connection.owner_id, created_by: connection.owner_id, updated_by: connection.owner_id,
          source_url: `https://www.youtube.com/watch?v=${row.video}`, brand: "브랜디액션", team: "콘텐츠", stage: "채널 자동 수집", description: "YouTube 분석 하루 기록",
          metric_current: 0, metric_unit: "views", starts_at: `${row.day}T12:00:00Z`,
          metadata: { contentId: row.video, channelId: connection.channel_id, platform: "YouTube", format: ytFormat(video.durationSeconds), metricMode: "daily", dataSource: DAILY, source: "api",
            day: row.day, measuredAt, publishedAt: video.publishedAt, durationSeconds: video.durationSeconds, views: 0, ...reach } }];
      });
      for (let i = 0; i < writes.length; i += 200) {
        const { error: writeError } = await db.from("os_records").upsert(writes.slice(i, i + 200), { onConflict: "id" });
        if (writeError) throw new Error("reach save failed");
      }
      counts.days += writes.length;
    } catch (reason) { if (reason instanceof ApiError && reason.code === "YOUTUBE_ANALYTICS_SCOPE_REQUIRED") counts.reconnectRequired++; else counts.failures++; }
  }
  return counts;
}
