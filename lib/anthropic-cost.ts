/**
 * Claude API spend (owner request 2026-11-02). Anthropic's Cost API (legacy cost_report, Admin API key) reports what the
 * organization spent in daily UTC buckets, amounts in cents as decimal strings; it has no balance, so the OS shows this month's spend.
 */
export function anthropicCosts(page: unknown) {
  const buckets = (page as { data?: { starting_at?: unknown; results?: { amount?: unknown; currency?: unknown }[] }[] })?.data ?? [];
  const daily = buckets.filter((bucket) => typeof bucket.starting_at === "string").map((bucket) => ({
    day: String(bucket.starting_at).slice(0, 10),
    usd: (bucket.results ?? []).reduce((sum, row) => sum + (row.currency === undefined || row.currency === "USD" ? Number(row.amount) || 0 : 0), 0) / 100,
  }));
  return { spent: daily.reduce((sum, row) => sum + row.usd, 0), daily };
}
