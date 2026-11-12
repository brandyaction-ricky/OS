import { createHash } from "node:crypto";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { YT_DAY_METRICS, addDays, dayFields, dueYtSnapshots, parseYtDays, ptDay, ytFormat, ytSnapshot, type Snapshot, type YtDay } from "@/lib/youtube-channel-analytics";
import { youtubeAnalyticsConnected } from "./channel-metrics";
import { getYoutubeAccessToken, type YoutubeStoredConnection } from "./youtube-oauth";
import { normalizeObservedVideo } from "./youtube-observation";

// 영상 성과 채우기 (로건 요청 2026-11-11 「지표 미연결」): every video of each connected channel, day by day, from YouTube Analytics.
// - Daily rows (metricMode "daily", platform "YouTube", contentId = video id) make the page count views gained in the chosen dates
//   and stand in for the hourly cumulative rows of the same video (dedupeMetricSnapshots); they also carry 시청 지속률 and 구독자 순증.
// - D1 / D7 / D28 rows (channelSnapshotVersion 1, one per metric, publishId = video id) are the record of those first days, so
//   videos published before this job (or outside the OS) fill the 게시 후 경과일 비교 too.
// A video seen for the first time is read from its publish day (daily rows kept for the last 120 days); after that the last 7 days
// are read again each run, because Analytics settles a couple of days late.
// ponytail: one Analytics call per video per run (~150 a day for this channel); split across runs by the time budget if it grows.
const KEEP_DAYS = 120, REREAD_DAYS = 7;
const DAILY = "youtube_analytics_daily";
const uuid = (parts: unknown[]) => { const hex = createHash("sha256").update(JSON.stringify(parts)).digest("hex"); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`; };
export const ytDailyId = (channelId: string, videoId: string, day: string) => uuid(["yt-analytics-day", channelId, videoId, day]);
export const ytSnapshotId = (videoId: string, snapshot: Snapshot, metric: string) => uuid(["yt-analytics-snapshot", videoId, snapshot, metric]);

async function google<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const body = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new ApiError(response.status === 403 ? 409 : 502, response.status === 403 ? "YOUTUBE_ANALYTICS_SCOPE_REQUIRED" : "YOUTUBE_ANALYTICS_FAILED",
    response.status === 403 ? "YouTube 성과 권한을 확인하고 채널을 다시 연결해 주세요." : "YouTube 성과를 불러오지 못했습니다.", body.error?.message);
  return body;
}

type Item = Parameters<typeof normalizeObservedVideo>[0];
/** Every upload of the channel (the uploads playlist, page by page), with its length for 숏폼 / 롱폼. */
async function channelUploads(token: string, channelId: string) {
  const data = "https://www.googleapis.com/youtube/v3";
  const channel = await google<{ items?: Item[] }>(`${data}/channels?${new URLSearchParams({ part: "contentDetails", id: channelId })}`, token);
  const playlistId = channel.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!playlistId) return [];
  const ids: string[] = [];
  for (let page = "", n = 0; n < 40; n++) {
    const list = await google<{ items?: Item[]; nextPageToken?: string }>(`${data}/playlistItems?${new URLSearchParams({ part: "contentDetails", playlistId, maxResults: "50", ...(page ? { pageToken: page } : {}) })}`, token);
    ids.push(...(list.items ?? []).map((item) => item.contentDetails?.videoId ?? "").filter(Boolean));
    if (!list.nextPageToken) break;
    page = list.nextPageToken;
  }
  const videos = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = await google<{ items?: Item[] }>(`${data}/videos?${new URLSearchParams({ part: "snippet,contentDetails", id: ids.slice(i, i + 50).join(",") })}`, token);
    videos.push(...(batch.items ?? []).map(normalizeObservedVideo).filter((video) => video.id && video.publishedAt));
  }
  return videos.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

async function videoDays(token: string, videoId: string, from: string, to: string): Promise<YtDay[]> {
  const params = new URLSearchParams({ ids: "channel==MINE", startDate: from, endDate: to, dimensions: "day", sort: "day", metrics: YT_DAY_METRICS.join(","), filters: `video==${videoId}` });
  const body = await google<{ columnHeaders?: unknown; rows?: unknown }>(`https://youtubeanalytics.googleapis.com/v2/reports?${params}`, token);
  return parseYtDays(body.columnHeaders, body.rows ?? []);
}

export async function syncChannelAnalytics(now = new Date(), budgetMs = 240_000) {
  const started = Date.now(), db = createServiceSupabase(), today = ptDay(now), measuredAt = now.toISOString();
  const { data: rows, error } = await db.from("os_youtube_connections").select("*");
  if (error) throw new ApiError(503, "YOUTUBE_CONNECTIONS_UNAVAILABLE", "YouTube 연결을 읽지 못했습니다.");
  const connections = (rows ?? []) as YoutubeStoredConnection[];
  const counts = { channels: 0, videos: 0, days: 0, snapshots: 0, reconnectRequired: 0, laterForTime: 0, failures: 0 };
  for (const connection of connections) {
    if (!youtubeAnalyticsConnected(connection)) { counts.reconnectRequired++; continue; }
    try {
      const token = await getYoutubeAccessToken(connection.owner_id, connection.channel_id);
      const videos = await channelUploads(token, connection.channel_id);
      counts.channels++;
      // Which videos already have recent daily rows (read again only the last days) and which snapshots exist (taken once).
      const { data: recent } = await db.from("os_records").select("metadata->>contentId").eq("record_type", "content_metric").eq("metadata->>dataSource", DAILY)
        .eq("metadata->>channelId", connection.channel_id).gte("starts_at", `${addDays(today, -REREAD_DAYS - 3)}T00:00:00Z`).limit(5000);
      const seen = new Set((recent ?? []).map((row) => String(Object.values(row)[0] ?? "")));
      const snapIds = videos.flatMap((video) => (["d1", "d7", "d28"] as Snapshot[]).map((s) => ytSnapshotId(video.id, s, "views")));
      const taken = new Set<string>();
      for (let i = 0; i < snapIds.length; i += 200) {
        const { data } = await db.from("os_records").select("id").in("id", snapIds.slice(i, i + 200));
        for (const row of data ?? []) taken.add(row.id);
      }
      for (const video of videos) {
        if (Date.now() - started > budgetMs) { counts.laterForTime++; continue; }
        const published = ptDay(video.publishedAt);
        const format = ytFormat(video.durationSeconds), platform = format === "shorts" ? "yt_shorts" : "yt_long";
        const keepFrom = seen.has(video.id) ? addDays(today, -REREAD_DAYS) : [published, addDays(today, -KEEP_DAYS)].sort().at(-1)!;
        const missing = dueYtSnapshots(published, today).filter((s) => !taken.has(ytSnapshotId(video.id, s, "views")));
        const from = missing.length ? published : keepFrom;
        if (from > today) continue;
        try {
          const days = await videoDays(token, video.id, from, today);
          counts.videos++;
          const base = { record_type: "content_metric", title: video.title, status: "done", owner_id: connection.owner_id, created_by: connection.owner_id, updated_by: connection.owner_id,
            source_url: `https://www.youtube.com/watch?v=${video.id}`, brand: "브랜디액션", team: "콘텐츠", stage: "채널 자동 수집" };
          const dailyRows = days.filter((d) => d.day >= keepFrom && d.views != null).map((d) => ({ ...base, id: ytDailyId(connection.channel_id, video.id, d.day),
            description: "YouTube 분석 하루 기록", metric_current: d.views ?? null, metric_unit: "views", starts_at: `${d.day}T12:00:00Z`,
            metadata: { contentId: video.id, channelId: connection.channel_id, platform: "YouTube", format, metricMode: "daily", dataSource: DAILY, source: "api",
              day: d.day, measuredAt, publishedAt: video.publishedAt, durationSeconds: video.durationSeconds, ...dayFields(d) } }));
          for (let i = 0; i < dailyRows.length; i += 200) {
            const { error: writeError } = await db.from("os_records").upsert(dailyRows.slice(i, i + 200), { onConflict: "id" });
            if (writeError) throw new Error("daily metric save failed");
          }
          counts.days += dailyRows.length;
          for (const snapshot of missing) {
            const totals = ytSnapshot(days, published, snapshot);
            if (!totals) continue;
            const snapRows = Object.entries(totals).map(([metric, value]) => ({ ...base, id: ytSnapshotId(video.id, snapshot, metric), description: "YouTube 분석 경과일 기록",
              metric_current: value, metric_unit: metric, starts_at: measuredAt,
              metadata: { channelSnapshotVersion: 1, source: "api", snapshot, platform, publishId: video.id, contentId: video.id, channelId: connection.channel_id, metric, value,
                measuredAt, publishedAt: video.publishedAt, metricMode: "cumulative", dataSource: "YouTube Analytics API" } }));
            const { error: snapError } = await db.from("os_records").upsert(snapRows, { onConflict: "id", ignoreDuplicates: true });
            if (snapError) throw new Error("snapshot save failed");
            counts.snapshots++;
          }
        } catch (reason) { if (reason instanceof ApiError && reason.code === "YOUTUBE_ANALYTICS_SCOPE_REQUIRED") { counts.reconnectRequired++; break; } counts.failures++; }
      }
    } catch (reason) { if (reason instanceof ApiError && reason.code === "YOUTUBE_ANALYTICS_SCOPE_REQUIRED") counts.reconnectRequired++; else counts.failures++; }
  }
  return counts;
}
