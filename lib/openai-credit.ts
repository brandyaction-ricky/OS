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
