/**
 * ChatGPT Pro's monthly API credit (OpenAI, 2026-10-28): granted when the subscription renews and gone when the next one starts.
 * OpenAI reports what an organization spent (Costs API, daily UTC buckets) but not the balance, so the OS shows grant − spent.
 */
export function creditCycle(now: Date, resetDay: number) {
  const at = (year: number, month: number) => new Date(Date.UTC(year, month, Math.min(resetDay, new Date(Date.UTC(year, month + 1, 0)).getUTCDate())));
  const year = now.getUTCFullYear(), month = now.getUTCMonth();
  const start = at(year, month) <= now ? at(year, month) : at(year, month - 1);
  return { start, end: at(start.getUTCFullYear(), start.getUTCMonth() + 1) };
}

/** USD in one Costs API page: data[].results[].amount.value. */
export function sumCosts(page: unknown) {
  const buckets = (page as { data?: { results?: { amount?: { value?: unknown; currency?: unknown } }[] }[] })?.data ?? [];
  return buckets.flatMap((bucket) => bucket.results ?? [])
    .reduce((sum, row) => sum + (row.amount?.currency === "usd" && typeof row.amount.value === "number" ? row.amount.value : 0), 0);
}

/** USD per UTC day in one Costs API page (buckets are 1d and start at 00:00 UTC). */
export function dailyCosts(page: unknown) {
  const buckets = (page as { data?: { start_time?: unknown }[] })?.data ?? [];
  return buckets.filter((bucket) => typeof bucket.start_time === "number")
    .map((bucket) => ({ day: new Date((bucket.start_time as number) * 1000).toISOString().slice(0, 10), usd: sumCosts({ data: [bucket] }) }));
}

const DAY = 86_400_000;
/**
 * 이 속도면 언제 바닥 (관제실 시안 P3): the last 7 UTC days against what is left. Days before the cycle began are not
 * counted in the pace. runOutAt is null when the credit outlasts the cycle or nothing was spent.
 */
export function creditForecast({ remaining, start, end, daily, now }: { remaining: number; start: string; end: string; daily: { day: string; usd: number }[]; now: Date }) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Array.from({ length: 7 }, (_, i) => new Date(today - (6 - i) * DAY).toISOString().slice(0, 10));
  const first = start.slice(0, 10);
  const week = days.map((day) => day < first ? 0 : daily.filter((row) => row.day === day).reduce((sum, row) => sum + row.usd, 0));
  const weekUsd = week.reduce((sum, usd) => sum + usd, 0);
  const counted = Math.max(1, Math.min(7, Math.floor((today - Date.parse(start.slice(0, 10))) / DAY) + 1));
  const perDay = weekUsd / counted;
  const runOut = perDay > 0 ? now.getTime() + (remaining / perDay) * DAY : Infinity;
  return { days, week, weekUsd, perDay, runOutAt: runOut < Date.parse(end) ? new Date(runOut).toISOString() : null };
}
