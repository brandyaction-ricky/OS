// KPIs per business. 마이인 runs month by month; 브랜디에듀 runs by cohort (기수), whose sales
// are the cohort product's payments in its recruiting window, whatever month they fall in.
// Revenue comes from the Toss ledger; other metrics are entered. Pure helpers shared by the KPI
// API, the daily sync, meeting prep and the screen.
export const KPI_BUSINESSES = [
  { key: "myin", label: "마이인", brand: "마이인", folder: "마이인", mode: "month" },
  { key: "edu", label: "브랜디에듀", brand: "브랜디액션 에듀", folder: "브랜디에듀", mode: "cohort" },
] as const;
export type KpiCohort = { id: string; name: string; product: string; salesFrom: string; salesTo: string; courseFrom: string; courseTo: string; version: number };
export const validDay = (value: unknown): value is string => typeof value === "string" && /^20\d{2}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
// The cohorts a meeting looks at: still recruiting or not yet finished, else the latest one.
export function currentCohorts<T extends Pick<KpiCohort, "courseTo" | "salesFrom">>(cohorts: T[], today: string) {
  const live = cohorts.filter(cohort => cohort.courseTo >= today);
  return live.length ? live : [...cohorts].sort((a, b) => b.salesFrom.localeCompare(a.salesFrom)).slice(0, 1);
}
export type KpiBusinessKey = typeof KPI_BUSINESSES[number]["key"];
export const kpiBusiness = (key: string) => KPI_BUSINESSES.find(business => business.key === key) ?? null;

export const kstMonth = (date = new Date()) => date.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }).slice(0, 7);
export function monthRange(month: string) {
  const [year, mm] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}
export const validMonth = (value: string | null) => !!value && /^20\d{2}-(0[1-9]|1[0-2])$/.test(value);

export const formatKpiValue = (value: number | null | undefined, unit: string) =>
  value === null || value === undefined ? "—" : unit === "원" ? `${Math.round(value).toLocaleString("ko-KR")}원` : `${value.toLocaleString("ko-KR")}${unit}`;
export const kpiProgress = (current: number | null | undefined, target: number | null | undefined) =>
  current === null || current === undefined || !target ? null : Math.round(current / target * 1000) / 10;

// scope: a month ("2026-10") or a cohort name.
export function kpiLogTitle(businessKey: KpiBusinessKey, scope: string) {
  const business = kpiBusiness(businessKey)!;
  return { title: `KPI 로그 · ${business.label} · ${scope}`, folder: `02_Wiki/${business.folder}/운영/KPI 로그` };
}
// One line per change, newest at the bottom: when, who, what.
export function kpiLogLine(at: Date, who: string, text: string) {
  const stamp = at.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16);
  return `- ${stamp} · ${who} · ${text}`;
}
