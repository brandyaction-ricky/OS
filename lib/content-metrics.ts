import type { OsRecord } from "./record-types";

export function metricValue(record: OsRecord, key: string): number | null {
  const value = record.metadata[key] ?? (key === "views" ? record.metric_current : key === "purchases" ? record.metadata.conversions : null);
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value); return Number.isFinite(number) ? number : null;
}
export function metricIdentity(record: OsRecord) {
  return String(record.metadata.contentId || record.metadata.youtubeId || record.parent_id || record.source_url || record.id);
}
export function dedupeMetricSnapshots(records: OsRecord[]) {
  const latest = new Map<string, OsRecord>();
  for (const record of records) {
    const mode = String(record.metadata.metricMode ?? "daily");
    const key = `${metricIdentity(record)}|${record.metadata.platform ?? ""}|${mode}|${mode === "cumulative" ? "latest" : (record.starts_at ?? record.created_at).slice(0, 10)}`;
    const previous = latest.get(key);
    const measured = String(record.metadata.measuredAt ?? record.updated_at);
    if (!previous || measured > String(previous.metadata.measuredAt ?? previous.updated_at)) latest.set(key, record);
  }
  const values = [...latest.values()];
  const dailyIdentities = new Set(values.filter((record) => record.metadata.metricMode !== "cumulative").map((record) => `${metricIdentity(record)}|${record.metadata.platform ?? ""}`));
  return values.filter((record) => record.metadata.metricMode !== "cumulative" || !dailyIdentities.has(`${metricIdentity(record)}|${record.metadata.platform ?? ""}`));
}
export function summarizeMetrics(records: OsRecord[]) {
  const sum = (key: string) => { const values = records.map((record) => metricValue(record, key)).filter((value): value is number => value !== null); return values.length ? values.reduce((a, b) => a + b, 0) : null; };
  const weighted = (key: string, weight: string) => {
    let total = 0; let weights = 0;
    for (const record of records) { const value = metricValue(record, key); const count = metricValue(record, weight); if (value !== null && count !== null && count > 0) { total += value * count; weights += count; } }
    return weights > 0 ? total / weights : null;
  };
  return { views: sum("views"), impressions: sum("impressions"), clicks: sum("clicks"), purchases: sum("purchases"), revenue: sum("revenue"), subscribers: sum("subscribers"), ctr: weighted("ctr", "impressions"), retention: weighted("retention", "views") };
}
export function metricDisplay(value: number | null, suffix = "") { return value === null ? "미연결" : `${value.toLocaleString("ko-KR", { maximumFractionDigits: suffix === "%" ? 1 : 0 })}${suffix}`; }
export function groupMetricDimension(records: OsRecord[], dimension: string) {
  const groups = new Map<string, OsRecord[]>();
  for (const record of records) {
    const key = String(dimension === "video" ? metricIdentity(record) : record.metadata[dimension] || "미분류");
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return [...groups].map(([key, group]) => ({ key, title: dimension === "video" ? group[0].title : key, count: group.length, ...summarizeMetrics(group) }));
}
export function fixedWeek(start: string) {
  const date = new Date(`${start}T00:00:00Z`); if (!Number.isFinite(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + 6); return { start, end: date.toISOString().slice(0, 10) };
}
