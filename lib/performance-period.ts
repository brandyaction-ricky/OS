// 영상 성과 기간 (2026-11-12 대표 요청: 어제·오늘·최근 3일·7일·이번 달·지난달처럼 바로 고르기).
// Pure helpers (no server or React imports): days are Korean days, the comparison span is the same length right before.
import type { OsRecord } from "./record-types";

export type PeriodId = "today" | "yesterday" | "3d" | "7d" | "30d" | "month" | "lastMonth" | "custom";
export const PERIODS: readonly { id: PeriodId; label: string }[] = [
  { id: "today", label: "오늘" }, { id: "yesterday", label: "어제" }, { id: "3d", label: "최근 3일" }, { id: "7d", label: "최근 7일" },
  { id: "30d", label: "최근 30일" }, { id: "month", label: "이번 달" }, { id: "lastMonth", label: "지난달" }, { id: "custom", label: "직접 선택" },
];
export const DEFAULT_PERIOD: PeriodId = "30d";

const KST = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });
export const kstDay = (at: Date | string = new Date()) => KST.format(typeof at === "string" ? new Date(at) : at);
export const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const spanDays = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
export const validDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));

/** The days a preset covers, both ends kept; 직접 선택 has none of its own. */
export function periodRange(id: PeriodId, today = kstDay()): { from: string; to: string } | null {
  const first = `${today.slice(0, 7)}-01`;
  switch (id) {
    case "today": return { from: today, to: today };
    case "yesterday": { const day = addDays(today, -1); return { from: day, to: day }; }
    case "3d": return { from: addDays(today, -2), to: today };
    case "7d": return { from: addDays(today, -6), to: today };
    case "30d": return { from: addDays(today, -29), to: today };
    case "month": return { from: first, to: today };
    case "lastMonth": { const end = addDays(first, -1); return { from: `${end.slice(0, 7)}-01`, to: end }; }
    default: return null;
  }
}

/** The chosen period from the address (?period=7d, or ?period=custom&from=…&to=…); anything else is the default. */
export function readPeriod(search: { get(name: string): string | null }, today = kstDay()) {
  const asked = search.get("period") as PeriodId | null;
  const from = search.get("from"), to = search.get("to");
  if (asked === "custom" && validDay(from) && validDay(to) && from <= to) return { id: "custom" as PeriodId, from, to };
  const id = PERIODS.some((item) => item.id === asked && item.id !== "custom") ? asked! : DEFAULT_PERIOD;
  return { id, ...periodRange(id, today)! };
}

/** The span right before [from, to] with the same number of days, for 「직전 7일보다」. */
export function previousRange(from: string, to: string) {
  const days = spanDays(from, to);
  return { from: addDays(from, -days), to: addDays(from, -1), days };
}

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
export const dayLabel = (day: string) => { const d = new Date(`${day}T00:00:00Z`); return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WEEKDAY[d.getUTCDay()]})`; };
export const shortDay = (day: string) => `${Number(day.slice(5, 7))}.${Number(day.slice(8, 10))}`;
/** 「11월 6일 (목) ~ 11월 12일 (수) · 7일」, or one day alone. */
export const rangeLabel = (from: string, to: string) => from === to ? dayLabel(from) : `${dayLabel(from)} ~ ${dayLabel(to)} · ${spanDays(from, to)}일`;

/** 롱폼 / 숏폼 of a YouTube metric row: the format the row carries, then its platform name, then YouTube's 3-minute Shorts limit. */
export function youtubeFormat(metadata: OsRecord["metadata"]): "shorts" | "long" {
  const named = `${metadata.format ?? ""} ${metadata.youtubeFormat ?? ""} ${metadata.platform ?? ""}`.toLowerCase();
  if (/short|쇼츠/.test(named)) return "shorts";
  const seconds = Number(metadata.durationSeconds);
  return seconds > 0 && seconds <= 180 ? "shorts" : "long";
}

/** 「▲ 12%」 against the span before; a rate compares in points (%p). Nothing to compare with is null, never 0%. */
export function changeLabel(now: number | null, before: number | null, rate = false) {
  if (now === null || before === null) return null;
  const diff = rate ? now - before : before === 0 ? null : (now - before) / Math.abs(before) * 100;
  if (diff === null) return null;
  const rounded = Math.round(diff * 10) / 10;
  if (rounded === 0) return { text: rate ? "변화 없음" : "같음", tone: "flat" as const };
  return { text: `${rounded > 0 ? "▲" : "▼"} ${Math.abs(rounded).toLocaleString("ko-KR")}${rate ? "%p" : "%"}`, tone: rounded > 0 ? "up" as const : "down" as const };
}
