/**
 * Claude API spend (owner request 2026-11-02). Anthropic's Usage and Cost Analytics API (Admin API key) totals a range in one row
 * when no time buckets are asked for — up to its last refresh, so today's spend is in, unlike the legacy daily cost report, which
 * only had finished days. Amounts are cents as decimal strings; Anthropic has no balance, so the OS shows spend only.
 */
export function anthropicTotal(page: unknown) {
  const rows = (page as { data?: { cost?: { amount?: unknown; currency?: unknown } }[] })?.data ?? [];
  return rows.reduce((sum, row) => sum + (row.cost?.currency === undefined || row.cost.currency === "USD" ? Number(row.cost?.amount) || 0 : 0), 0) / 100;
}
