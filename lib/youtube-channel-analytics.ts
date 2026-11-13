// 영상 성과 채우기 (로건 요청 2026-11-11 「지표 미연결」): the company channel's every video, day by day, from YouTube Analytics.
// Pure helpers (no server imports) so the day maths can be tested on their own. Analytics days are Pacific Time days.

/** What one video's day report asks for. averageViewPercentage becomes the page's 시청 지속률 (already a percent). */
export const YT_DAY_METRICS = ["views", "likes", "comments", "shares", "estimatedMinutesWatched", "averageViewDuration", "averageViewPercentage", "subscribersGained", "subscribersLost"] as const;
export type YtDayMetric = typeof YT_DAY_METRICS[number];
export type YtDay = { day: string } & Partial<Record<YtDayMetric, number>>;

/** YouTube's own Shorts limit is 3 minutes; the channel's longform is far longer, so length alone tells them apart. */
export const ytFormat = (durationSeconds: number | null | undefined) => durationSeconds != null && durationSeconds > 0 && durationSeconds <= 180 ? "shorts" as const : "long" as const;

const PT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });
/** The Pacific Time day of an instant, as YouTube Analytics counts days. */
export const ptDay = (at: string | Date) => PT.format(typeof at === "string" ? new Date(at) : at);
export const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** A day report (dimensions=day) as one object per day; values that are not finite non-negative numbers are left out, never zero. */
export function parseYtDays(headers: unknown, rows: unknown): YtDay[] {
  if (!Array.isArray(headers) || !Array.isArray(rows)) return [];
  const names = headers.map((header) => typeof header === "object" && header ? String((header as { name?: unknown }).name ?? "") : "");
  const dayAt = names.indexOf("day");
  if (dayAt < 0) return [];
  return rows.filter(Array.isArray).map((row: unknown[]) => {
    const out: YtDay = { day: String(row[dayAt] ?? "") };
    for (const metric of YT_DAY_METRICS) { const value = row[names.indexOf(metric)]; if (names.includes(metric) && typeof value === "number" && Number.isFinite(value) && value >= 0) out[metric] = value; }
    return out;
  }).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.day));
}

/** Something happened that day: a view, like, comment, share, watch minute or subscriber change. */
export const hasActivity = (day: YtDay) => (["views", "likes", "comments", "shares", "estimatedMinutesWatched", "subscribersGained", "subscribersLost"] as const).some((metric) => (day[metric] ?? 0) > 0);

/** One day's row fields as the 영상 성과 cards read them (views, retention weighted by views, net subscribers). */
export function dayFields(day: YtDay) {
  const net = day.subscribersGained != null && day.subscribersLost != null ? day.subscribersGained - day.subscribersLost : undefined;
  return { views: day.views, likes: day.likes, comments: day.comments, shares: day.shares, watchMinutes: day.estimatedMinutesWatched,
    averageViewDuration: day.averageViewDuration, retention: day.averageViewPercentage, subscribers: net, subscribersGained: day.subscribersGained, subscribersLost: day.subscribersLost };
}

export type Snapshot = "d1" | "d7" | "d28";
const SNAP_DAYS: Record<Snapshot, number> = { d1: 1, d7: 7, d28: 28 };
/** Analytics settles about two days late, so dN is taken once day N is three days past. */
export const dueYtSnapshots = (publishedDay: string, today: string) => (Object.keys(SNAP_DAYS) as Snapshot[]).filter((s) => addDays(publishedDay, SNAP_DAYS[s] + 3) <= today);

/**
 * dN = the video's first N+1 Pacific days (publish day through day N) added up — the record of those days, not today's total
 * relabelled. Averages are weighted by that day's views. The caller asks from the publish day on; no days at all gives null, not zeros.
 */
export function ytSnapshot(days: YtDay[], publishedDay: string, snapshot: Snapshot) {
  const last = addDays(publishedDay, SNAP_DAYS[snapshot]);
  const span = days.filter((d) => d.day >= publishedDay && d.day <= last);
  if (!span.length) return null;
  const sum = (m: YtDayMetric) => span.reduce((total, d) => total + (d[m] ?? 0), 0);
  const views = sum("views");
  const weighted = (m: YtDayMetric) => views > 0 ? span.reduce((total, d) => total + (d[m] ?? 0) * (d.views ?? 0), 0) / views : 0;
  return { views, likes: sum("likes"), comments: sum("comments"), shares: sum("shares"), estimatedMinutesWatched: sum("estimatedMinutesWatched"),
    averageViewDuration: Math.round(weighted("averageViewDuration")), averageViewPercentage: Math.round(weighted("averageViewPercentage") * 10) / 10,
    subscribersGained: sum("subscribersGained"), subscribersLost: sum("subscribersLost") };
}

export type ReachDay = { day: string; video: string; impressions: number; ctr: number | null };
/** One Reach report (channel_reach_basic_a1: date, channel_id, video_id, video_thumbnail_impressions, video_thumbnail_impressions_ctr)
 *  as rows, its CTR as the API wrote it. Dates come as YYYYMMDD (Pacific days, as Analytics counts them). */
export function parseReachCsv(text: string): ReachDay[] {
  const [head = "", ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(",").map((name) => name.trim()), at = (name: string) => cols.indexOf(name);
  const [date, video, impressions, ctr] = [at("date"), at("video_id"), at("video_thumbnail_impressions"), at("video_thumbnail_impressions_ctr")];
  if (date < 0 || video < 0 || impressions < 0) return [];
  return lines.map((line) => line.split(",")).map((c) => {
    const raw = String(c[date] ?? "").trim(), rate = ctr >= 0 && String(c[ctr] ?? "").trim() !== "" ? Number(c[ctr]) : NaN;
    return { day: /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw, video: String(c[video] ?? "").trim(), impressions: Number(c[impressions]), ctr: Number.isFinite(rate) && rate >= 0 ? rate : null };
  }).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.day) && row.video && Number.isFinite(row.impressions) && row.impressions >= 0);
}

/** CTR in percent. The API calls it a percentage without saying the scale, so a run whose CTRs all stay at or under 1 is read as
 *  fractions (a channel's thumbnails always include some above 1%). ponytail: a channel whose every CTR is under 1% would read ×100. */
export function reachPercent(rows: ReachDay[]): ReachDay[] {
  const fraction = rows.every((row) => row.ctr === null || row.ctr <= 1);
  return rows.map((row) => ({ ...row, ctr: row.ctr === null ? null : Math.round((fraction ? row.ctr * 100 : row.ctr) * 100) / 100 }));
}
