import { ApiError } from "@/lib/http";
import { anthropicTotal } from "@/lib/anthropic-cost";
import { cachedRead } from "./openai-credit";

export const readAnthropicCost = cachedRead("anthropic-cost", () => fetchAnthropicCost());

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
  const [spent, spent30] = await Promise.all([totalSince(key, month), totalSince(key, start)]);
  return { configured: true as const, month, spent, spent30 };
}

/** Dollars spent from `from` until now (no ending_at: the API takes the current time, rounded down to the hour). */
async function totalSince(key: string, from: string) {
  let usd = 0, page = "";
  for (let i = 0; i < 5; i++) {   // no group_by: one row
    const url = new URL("https://api.anthropic.com/v1/organizations/analytics/cost");
    url.search = new URLSearchParams({ starting_at: from, ...(page ? { page } : {}) }).toString();
    const response = await fetch(url, {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-beta": "analytics-usage-cost-2026-08-24" },
      cache: "no-store", signal: AbortSignal.timeout(20_000),
    }).catch(() => { throw new ApiError(502, "ANTHROPIC_COSTS_UNREACHABLE", "Anthropic에 연결하지 못했어요. 잠시 뒤 다시 열어 주세요."); });
    if (!response.ok) {
      // The error type (e.g. authentication_error) says what to fix; the message is not shown.
      const code = await response.json().then((body: { error?: { type?: unknown } }) => String(body.error?.type || "").replace(/[^\w.-]/g, "").slice(0, 60), () => "");
      console.error(`anthropic costs ${response.status} ${code}`);
      throw new ApiError(502, "ANTHROPIC_COSTS_FAILED", `Claude 사용 금액을 불러오지 못했어요(${[response.status, code].filter(Boolean).join(" · ")}). 관리자 키를 확인해 주세요.`);
    }
    const body = await response.json() as { has_more?: boolean; next_page?: string | null };
    usd += anthropicTotal(body);
    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }
  return usd;
}
