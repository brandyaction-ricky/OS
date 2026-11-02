import { ApiError } from "@/lib/http";
import { anthropicCosts } from "@/lib/anthropic-cost";
import { cachedRead } from "./openai-credit";

export const readAnthropicCost = cachedRead(() => fetchAnthropicCost());

/**
 * Claude API spend this month and over the last 30 days: ANTHROPIC_ADMIN_KEY (an Admin API key, sk-ant-admin01-…, of the
 * organization the OS key belongs to). Owner 2026-11-02: spend only — the balance mixes the Ultra grant with card top-ups and
 * Anthropic has no balance API, so the Console keeps it.
 */
async function fetchAnthropicCost(now = new Date()) {
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29)).toISOString();
  const key = process.env.ANTHROPIC_ADMIN_KEY?.trim();
  if (!key) return { configured: false as const, month };
  let page = "";
  const daily: { day: string; usd: number }[] = [];
  for (let i = 0; i < 3; i++) {   // 30 daily buckets: one page
    const url = new URL("https://api.anthropic.com/v1/organizations/cost_report");
    url.search = new URLSearchParams({ starting_at: start, bucket_width: "1d", limit: "31", ...(page ? { page } : {}) }).toString();
    const response = await fetch(url, { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }, cache: "no-store", signal: AbortSignal.timeout(20_000) })
      .catch(() => { throw new ApiError(502, "ANTHROPIC_COSTS_UNREACHABLE", "Anthropic에 연결하지 못했어요. 잠시 뒤 다시 열어 주세요."); });
    if (!response.ok) {
      // The error type (e.g. authentication_error) says what to fix; the message is not shown.
      const code = await response.json().then((body: { error?: { type?: unknown } }) => String(body.error?.type || "").replace(/[^\w.-]/g, "").slice(0, 60), () => "");
      console.error(`anthropic costs ${response.status} ${code}`);
      throw new ApiError(502, "ANTHROPIC_COSTS_FAILED", `Claude 사용 금액을 불러오지 못했어요(${[response.status, code].filter(Boolean).join(" · ")}). 관리자 키를 확인해 주세요.`);
    }
    const body = await response.json() as { has_more?: boolean; next_page?: string | null };
    daily.push(...anthropicCosts(body).daily);
    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }
  const sum = (rows: typeof daily) => rows.reduce((total, row) => total + row.usd, 0);
  return { configured: true as const, month, spent: sum(daily.filter((row) => row.day >= month.slice(0, 10))), spent30: sum(daily), daily };
}
