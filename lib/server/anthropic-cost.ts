import { ApiError } from "@/lib/http";
import { anthropicCosts } from "@/lib/anthropic-cost";
import { creditCycle } from "@/lib/openai-credit";
import { cachedRead } from "./openai-credit";

export const readAnthropicCost = cachedRead(() => fetchAnthropicCost());

/**
 * This cycle's Claude API credit (owner 2026-11-02: 200 dollars a month): ANTHROPIC_ADMIN_KEY (an Admin API key, sk-ant-admin01-…,
 * of the organization the OS key belongs to), the grant and the day it is topped up. Anthropic reports spend, not the balance.
 */
async function fetchAnthropicCost(now = new Date()) {
  const credit = Number(process.env.ANTHROPIC_MONTHLY_CREDIT_USD || 200);
  const cycle = creditCycle(now, Number(process.env.ANTHROPIC_CREDIT_RESET_DAY || 1));
  const start = cycle.start.toISOString(), end = cycle.end.toISOString();
  const key = process.env.ANTHROPIC_ADMIN_KEY?.trim();
  if (!key) return { configured: false as const, credit, start, end };
  let spent = 0, page = "";
  const daily: { day: string; usd: number }[] = [];
  for (let i = 0; i < 3; i++) {   // a month is at most 31 daily buckets: one page
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
    const costs = anthropicCosts(body);
    spent += costs.spent;
    daily.push(...costs.daily);
    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }
  return { configured: true as const, credit, start, end, spent, remaining: Math.max(0, credit - spent), daily };
}
