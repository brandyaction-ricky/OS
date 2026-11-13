// 영상 성과 under a second (2026-11-12): the YouTube Analytics day rows arrive added up (os_content_metric_summary) instead of
// one row per video per day. Pure helpers: the same totals from day rows (when the database function is missing, and the demo),
// and one row per video so the page's cards, tables and filters keep working on records.
import type { OsRecord } from "./record-types";

type Sums = { views: number | null; likes: number | null; comments: number | null; shares: number | null; watchMinutes: number | null; subscribers: number | null; retentionViews: number | null; retentionSum: number | null;
  impressions?: number | null; ctrImpressions?: number | null; ctrSum?: number | null };
export type SummaryDay = Sums & { day: string; format: string };
export type SummaryVideo = Sums & { video: string; format: string; title: string; url: string | null; channelId: string | null; publishedAt: string | null; durationSeconds: number | null; days: number; lastDay: string; durationSum: number | null };
export type MetricSummary = { days: SummaryDay[]; videos: SummaryVideo[]; rows: OsRecord[] };

export const ANALYTICS_DAILY = "youtube_analytics_daily";
const num = (value: unknown) => { const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN; return Number.isFinite(n) ? n : null; };
const add = (a: number | null, b: number | null) => b === null ? a : (a ?? 0) + b;

/** The database function's days and videos, worked out from day rows the same way (missing values stay missing, never 0). */
export function summarizeDayRows(rows: OsRecord[]): Pick<MetricSummary, "days" | "videos"> {
  const days = new Map<string, SummaryDay>(), videos = new Map<string, SummaryVideo>();
  const empty = (): Sums => ({ views: null, likes: null, comments: null, shares: null, watchMinutes: null, subscribers: null, retentionViews: null, retentionSum: null, impressions: null, ctrImpressions: null, ctrSum: null });
  for (const row of rows) {
    const m = row.metadata, day = String(m.day ?? (row.starts_at ?? row.created_at).slice(0, 10)), format = String(m.format || "long");
    const views = num(m.views), retention = num(m.retention), duration = num(m.averageViewDuration), weighted = retention !== null && views !== null && views > 0;
    const impressions = num(m.impressions), ctr = num(m.ctr), clicked = ctr !== null && impressions !== null && impressions > 0;
    const sum = (into: Sums) => {
      into.views = add(into.views, views); into.likes = add(into.likes, num(m.likes)); into.comments = add(into.comments, num(m.comments)); into.shares = add(into.shares, num(m.shares));
      into.watchMinutes = add(into.watchMinutes, num(m.watchMinutes)); into.subscribers = add(into.subscribers, num(m.subscribers));
      if (weighted) { into.retentionViews = add(into.retentionViews, views); into.retentionSum = add(into.retentionSum, retention! * views!); }
      into.impressions = add(into.impressions ?? null, impressions);
      if (clicked) { into.ctrImpressions = add(into.ctrImpressions ?? null, impressions); into.ctrSum = add(into.ctrSum ?? null, ctr! * impressions!); }
    };
    const dayKey = `${day}|${format}`, dayItem = days.get(dayKey) ?? { ...empty(), day, format };
    sum(dayItem); days.set(dayKey, dayItem);
    const video = typeof m.contentId === "string" && m.contentId ? m.contentId : null;
    if (!video) continue;
    const videoKey = `${video}|${format}`;
    const item = videos.get(videoKey) ?? { ...empty(), video, format, title: row.title, url: row.source_url, channelId: (m.channelId as string) ?? null, publishedAt: (m.publishedAt as string) ?? null, durationSeconds: num(m.durationSeconds), days: 0, lastDay: day, durationSum: null };
    sum(item); item.days += 1; if (day > item.lastDay) item.lastDay = day;
    if (duration !== null && views !== null && views > 0) item.durationSum = add(item.durationSum, duration * views);
    videos.set(videoKey, item);
  }
  return { days: [...days.values()], videos: [...videos.values()] };
}

/** One record per video carrying its sums over the chosen days — read-only (metadata.summary), dated on its last day. */
export function videoRows(videos: SummaryVideo[], owner = ""): OsRecord[] {
  return videos.map((v) => {
    const at = `${v.lastDay}T12:00:00Z`, views = num(v.views);
    return { id: `summary-${v.video}-${v.format}`, record_type: "content_metric", title: v.title, description: "", status: "done", priority: "normal", stage: "", brand: "브랜디액션", team: "콘텐츠",
      owner_id: owner || null, assignee_id: null, parent_id: null, due_date: null, starts_at: at, ends_at: null, progress: 0, metric_target: null, metric_current: views, metric_unit: "views",
      amount: null, currency: "KRW", source_url: v.url, tags: [], version: 1, created_by: owner, updated_by: owner, created_at: at, updated_at: at, archived_at: null,
      metadata: { contentId: v.video, platform: "YouTube", format: v.format, metricMode: "daily", dataSource: ANALYTICS_DAILY, summary: true, days: num(v.days) ?? 0,
        views, likes: num(v.likes), comments: num(v.comments), shares: num(v.shares), watchMinutes: num(v.watchMinutes), subscribers: num(v.subscribers),
        retention: num(v.retentionViews) ? num(v.retentionSum)! / num(v.retentionViews)! : null,
        impressions: num(v.impressions), ctr: num(v.ctrImpressions) ? num(v.ctrSum)! / num(v.ctrImpressions)! : null,
        averageViewDuration: views && num(v.durationSum) !== null ? Math.round(num(v.durationSum)! / views) : null,
        publishedAt: v.publishedAt, channelId: v.channelId, durationSeconds: num(v.durationSeconds), measuredAt: at } } as OsRecord;
  });
}

/** Views per day for the chart (롱폼/숏폼 or both). */
export function viewsByDay(days: SummaryDay[], format: "all" | "long" | "shorts") {
  const out = new Map<string, number>();
  for (const d of days) if (format === "all" || d.format === format) { const v = num(d.views); if (v !== null) out.set(d.day, (out.get(d.day) ?? 0) + v); }
  return out;
}
