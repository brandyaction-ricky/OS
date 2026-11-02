import { unstable_cache } from "next/cache";
import { ApiError } from "@/lib/http";
import { creditCycle, dailyCosts, sumCosts } from "@/lib/openai-credit";
import { GPT_SAVING_BELOW_USD, type GptTier } from "@/lib/youtube-process/gpt-draft";

const FRESH_MS = 5 * 60_000, STALE_MS = 60 * 60_000;

/**
 * A provider's cost read at most once per 5 minutes (calls made at once share the read). Every GPT job asks for the tier too,
 * and OpenAI's Costs API answered 429 to the 작동 상태 panel (2026-11-02). The read is kept in Next's data cache, shared by every
 * server instance — each instance asking for itself still got 429 right after the deploy; a failed read falls back to the last
 * good one from the past hour.
 */
export function cachedRead<T>(name: string, read: () => Promise<T>) {
  const shared = unstable_cache(read, [name], { revalidate: FRESH_MS / 1000 });
  let asked: { at: number; value: Promise<T> } | null = null;
  let good: { at: number; value: T } | null = null;
  return (): Promise<T> => {
    const now = Date.now();
    if (asked && now - asked.at < FRESH_MS) return asked.value;
    const value = shared().then(
      (result) => { good = { at: Date.now(), value: result }; return result; },
      (error) => { asked = null; if (good && Date.now() - good.at < STALE_MS) return good.value; throw error; });
    asked = { at: now, value };
    return value;
  };
}

export const readOpenAiCredit = cachedRead("openai-credit", () => fetchOpenAiCredit());

/** This cycle's GPT API credit: OPENAI_ADMIN_KEY (read-only admin key of the organization the OS key belongs to), the grant and its renewal day. */
async function fetchOpenAiCredit(now = new Date()) {
  const credit = Number(process.env.OPENAI_MONTHLY_CREDIT_USD || 500);
  const { start, end } = creditCycle(now, Number(process.env.OPENAI_CREDIT_RESET_DAY || 1));
  const cycle = { credit, start: start.toISOString(), end: end.toISOString() };
  const key = process.env.OPENAI_ADMIN_KEY?.trim();
  if (!key) return { configured: false as const, ...cycle };
  let spent = 0, page = "";
  const daily: { day: string; usd: number }[] = [];
  for (let i = 0; i < 5; i++) {   // a cycle is at most 31 daily buckets: one page
    const url = new URL("https://api.openai.com/v1/organization/costs");
    url.search = new URLSearchParams({ start_time: String(Math.floor(start.getTime() / 1000)), bucket_width: "1d", limit: "31", ...(page ? { page } : {}) }).toString();
    const response = await fetch(url, { headers: { authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) })
      .catch(() => { throw new ApiError(502, "OPENAI_COSTS_UNREACHABLE", "OpenAI에 연결하지 못했어요. 잠시 뒤 다시 열어 주세요."); });
    if (!response.ok) {
      // OpenAI's error code (e.g. invalid_api_key) says what to fix; its message is not shown, it can quote part of the key.
      const code = await response.json().then((body: { error?: { code?: unknown; type?: unknown } }) => String(body.error?.code || body.error?.type || "").replace(/[^\w.-]/g, "").slice(0, 60), () => "");
      console.error(`openai costs ${response.status} ${code}`);
      throw new ApiError(502, "OPENAI_COSTS_FAILED", `OpenAI 사용 금액을 불러오지 못했어요(${[response.status, code].filter(Boolean).join(" · ")}). 관리자 키를 확인해 주세요.`);
    }
    const body = await response.json() as { next_page?: string | null };
    spent += sumCosts(body);
    daily.push(...dailyCosts(body));
    if (!body.next_page) break;
    page = body.next_page;
  }
  return { configured: true as const, ...cycle, spent, remaining: Math.max(0, credit - spent), daily };
}

/** 정밀 unless this month's credit is nearly used up (an unreadable balance counts as plenty). */
export async function creditTier(): Promise<GptTier> {
  const credit = await readOpenAiCredit().catch(() => null);
  return credit?.configured && (credit.remaining ?? 0) < GPT_SAVING_BELOW_USD ? "saving" : "precise";
}
