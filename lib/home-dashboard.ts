import type { OsRecord } from "./record-types";

const CONTENT_TYPES = new Set<OsRecord["record_type"]>([
  "content_topic",
  "content_script",
  "content_package",
  "content_short",
  "content_publish",
]);

const INACTIVE_CONTENT_STATUSES = new Set(["done", "published", "cancelled"]);

export interface RevenueBandValue {
  current: number;
  goal: number;
  monthChange: number | null;
  weekChange: number | null;
}

export interface HomeRevenueView {
  total: RevenueBandValue;
  myin: RevenueBandValue;
  edu: RevenueBandValue;
  lastUpdatedAt: string | null;
}

export interface HomeVideo {
  id: string;
  title: string;
  brand: string;
  stage: string;
  status: string;
  dueDate: string | null;
  updatedAt: string;
}

export function attainmentPercent(record: OsRecord): number | null {
  const target = Number(record.metric_target);
  const current = Number(record.metric_current);
  if (
    record.metric_target === null ||
    record.metric_current === null ||
    !Number.isFinite(target) ||
    !Number.isFinite(current) ||
    target <= 0
  ) return null;
  return Math.max(0, Math.round((current / target) * 100));
}

export function averageAttainment(records: OsRecord[]): number | null {
  const measured = records
    .map(attainmentPercent)
    .filter((value): value is number => value !== null);
  if (!measured.length) return null;
  return Math.round(measured.reduce((sum, value) => sum + value, 0) / measured.length);
}

function recordDate(record: OsRecord) {
  return String(record.metadata.date ?? record.starts_at ?? record.created_at).slice(0, 10);
}

function recordMonth(record: OsRecord) {
  const periodMonth = record.metadata.periodMonth;
  return typeof periodMonth === "string"
    ? periodMonth
    : record.due_date?.slice(0, 7) || record.starts_at?.slice(0, 7) || record.created_at.slice(0, 7);
}

function previousMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function brandKey(value: string): "myin" | "edu" | "all" {
  const normalized = value.toLowerCase().replace(/\s/g, "");
  if (normalized.includes("마이인") || normalized.includes("myin")) return "myin";
  if (normalized.includes("에듀") || normalized.includes("edu")) return "edu";
  return "all";
}

function revenueAmount(record: OsRecord) {
  const value = Number(record.metadata.net ?? record.amount ?? record.metric_current ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function changePercent(current: number, previous: number) {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1_000) / 10;
}

function monetaryTarget(record: OsRecord) {
  const target = Number(record.metric_target);
  if (!Number.isFinite(target) || target <= 0) return 0;
  const unit = record.metric_unit.toLowerCase().replace(/\s/g, "");
  const terms = `${record.title} ${record.tags.join(" ")} ${String(record.metadata.metricKind ?? "")}`.toLowerCase();
  const monetaryUnit = /(원|만원|억원|억|krw)/.test(unit);
  if (!monetaryUnit && (unit || !/(매출|revenue)/.test(terms))) return 0;
  if (unit.includes("억원") || unit === "억") return target * 100_000_000;
  if (unit.includes("만원")) return target * 10_000;
  return target;
}

function targetByBrand(records: OsRecord[], key: "myin" | "edu" | "all") {
  const candidates = records.filter((record) => brandKey(record.brand) === key && monetaryTarget(record) > 0);
  const goals = candidates.filter((record) => record.record_type === "goal");
  const source = goals.length ? goals : candidates.filter((record) => record.record_type === "kpi");
  return source.reduce((sum, record) => sum + monetaryTarget(record), 0);
}

export function buildHomeRevenueView(records: OsRecord[], now = new Date()): HomeRevenueView {
  const today = now.toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const lastMonth = previousMonth(month);
  const elapsedDay = Number(today.slice(8, 10));
  const todayMs = Date.parse(`${today}T00:00:00.000Z`);
  const revenue = records.filter((record) => record.record_type === "revenue");
  const goals = records.filter((record) => ["goal", "kpi"].includes(record.record_type) && recordMonth(record) === month);

  const band = (key: "myin" | "edu" | "all"): RevenueBandValue => {
    const matches = (record: OsRecord) => key === "all" || brandKey(record.brand || record.title) === key;
    const current = revenue.filter((record) => recordDate(record).startsWith(month) && matches(record)).reduce((sum, record) => sum + revenueAmount(record), 0);
    // Compare month-to-date with the same elapsed days of the previous month.
    // A full previous month against the first few days of a new month creates a
    // false -100% warning and is not an actionable operating signal.
    const priorMonth = revenue.filter((record) => {
      const date = recordDate(record);
      return date.startsWith(lastMonth) && Number(date.slice(8, 10)) <= elapsedDay && matches(record);
    }).reduce((sum, record) => sum + revenueAmount(record), 0);
    const weekly = revenue.reduce((totals, record) => {
      if (!matches(record)) return totals;
      const recordMs = Date.parse(`${recordDate(record)}T00:00:00.000Z`);
      const daysAgo = Math.floor((todayMs - recordMs) / 86_400_000);
      if (daysAgo >= 0 && daysAgo < 7) totals.current += revenueAmount(record);
      if (daysAgo >= 7 && daysAgo < 14) totals.previous += revenueAmount(record);
      return totals;
    }, { current: 0, previous: 0 });
    const explicitGoal = targetByBrand(goals, key);
    const goal = key === "all" && !explicitGoal
      ? targetByBrand(goals, "myin") + targetByBrand(goals, "edu")
      : explicitGoal;
    return {
      current,
      goal,
      monthChange: changePercent(current, priorMonth),
      weekChange: changePercent(weekly.current, weekly.previous),
    };
  };

  const currentMonthRevenue = revenue.filter((record) => recordDate(record).startsWith(month));
  const lastUpdatedAt = currentMonthRevenue.reduce<string | null>((latest, record) =>
    !latest || record.updated_at > latest ? record.updated_at : latest, null);
  return { total: band("all"), myin: band("myin"), edu: band("edu"), lastUpdatedAt };
}

function normalizedVideoTitle(value: string) {
  return value
    .replace(/\s*·\s*(유튜브 발행 키트|제목·썸네일 후보|기획 브리핑|원고)\s*$/u, "")
    .trim();
}

function parentKey(record: OsRecord) {
  const metadataParent = record.metadata.sourceId ?? record.metadata.legacySourceId;
  return record.parent_id || (typeof metadataParent === "string" ? metadataParent : null);
}

function contentRoot(record: OsRecord, byId: Map<string, OsRecord>) {
  let current = record;
  const seen = new Set([record.id]);
  for (let depth = 0; depth < 12; depth += 1) {
    const parentId = parentKey(current);
    const parent = parentId ? byId.get(parentId) : null;
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    current = parent;
  }
  return current;
}

function contentStage(record: OsRecord) {
  if (record.record_type === "content_package") {
    const kind = String(record.metadata.packageKind ?? "");
    if (kind === "youtube_kit") return "발행 키트";
    if (kind === "title_package") return "제목·썸네일";
    if (kind === "topic_plan") return "기획 브리핑";
  }
  if (record.stage) return record.stage;
  const labels: Partial<Record<OsRecord["record_type"], string>> = {
    content_topic: "기획",
    content_script: "원고",
    content_package: "제목·썸네일",
    content_short: "숏폼",
    content_publish: "발행 준비",
  };
  return labels[record.record_type] ?? "제작 중";
}

function contentRank(record: OsRecord) {
  if (record.record_type === "content_publish") return 50;
  if (record.record_type === "content_short") return 40;
  if (record.record_type === "content_package" && record.metadata.packageKind === "youtube_kit") return 35;
  if (record.record_type === "content_package") return 30;
  if (record.record_type === "content_script") return 20;
  return 10;
}

function statusLabel(status: string) {
  return ({
    backlog: "대기",
    planned: "예정",
    active: "제작 중",
    draft: "초안",
    review: "검토",
    ready: "발행 대기",
    scheduled: "예약",
    blocked: "막힘",
  } as Record<string, string>)[status] ?? status;
}

export function groupHomeVideos(records: OsRecord[], limit = 6): HomeVideo[] {
  const content = records.filter((record) => CONTENT_TYPES.has(record.record_type));
  const byId = new Map(content.map((record) => [record.id, record]));
  const groups = new Map<string, { root: OsRecord; items: OsRecord[] }>();
  content
    .filter((record) => !INACTIVE_CONTENT_STATUSES.has(record.status))
    .forEach((record) => {
      const root = contentRoot(record, byId);
      const key = root.id || normalizedVideoTitle(root.title).toLowerCase();
      const group = groups.get(key) ?? { root, items: [] };
      group.items.push(record);
      groups.set(key, group);
    });

  return [...groups.values()]
    .map(({ root, items }) => {
      const current = [...items].sort((left, right) =>
        contentRank(right) - contentRank(left) || right.updated_at.localeCompare(left.updated_at))[0];
      const latest = [...items].sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];
      return {
        id: root.id,
        title: normalizedVideoTitle(root.title || current.title),
        brand: root.brand || current.brand || "공통",
        stage: contentStage(current),
        status: statusLabel(current.status),
        dueDate: current.due_date,
        updatedAt: latest.updated_at,
      };
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit);
}
