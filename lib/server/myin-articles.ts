import { ApiError } from "@/lib/http";

// MYIN 아티클 (owner request 2026-10-25: 「칼럼은 마이인 자사몰 칼럼에 올라가도록」): OS sends a column to MYIN as a draft and makes
// it public or not, through MYIN's integration path (myinlab-server PR #934). The same secret is set on both projects.
/** MYIN refuses a request body over 4 MB (its host stops 4.5 MB before the code runs); this stays under it. */
export const MYIN_BODY_MAX = 3_900_000;
export const MYIN_SLUG = /^[a-z0-9][a-z0-9-]{1,79}$/;
export interface MyinArticle { id: string; slug: string; status: "draft" | "published"; url: string; publishedAt?: string | null }

/** One MYIN source id per OS column, the same on every send (MYIN updates the article it already has). */
export const myinSourceId = (projectId: string, itemId: string) => `os-col-${projectId}-${itemId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 80);

const MESSAGES: Record<number, string> = {
  401: "마이인 연결 키가 맞지 않아요. 관리자에게 알려 주세요.",
  // MYIN's CSRF check answers a request with no key at all before the integration path sees it.
  403: "마이인 연결 키가 없어요. 관리자에게 알려 주세요.",
  404: "먼저 마이인에 임시 글로 올려 주세요.",
  409: "마이인에 같은 주소(slug)의 다른 글이 있어요. 칼럼 주소를 바꿔 주세요.",
  413: "이미지가 너무 커요. 합계 3MB 안으로 줄여 주세요.",
  503: "마이인 쪽 연결 설정이 아직 없어요. 관리자에게 알려 주세요.",
};

export async function callMyin(path: string, method: "PUT" | "POST", body: unknown): Promise<MyinArticle> {
  const base = process.env.MYIN_API_BASE?.trim().replace(/\/+$/, ""), secret = process.env.MYIN_OS_ARTICLE_SECRET?.trim();
  if (!base || !secret) throw new ApiError(503, "MYIN_NOT_CONFIGURED", "마이인 연결 설정이 아직 없어요. 관리자에게 알려 주세요.");
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  } catch { throw new ApiError(502, "MYIN_UNREACHABLE", "마이인에 연결하지 못했어요. 잠시 뒤 다시 해 주세요."); }
  const json = await response.json().catch(() => null) as { data?: MyinArticle; message?: string; error?: { message?: string } } | null;
  if (response.ok && json?.data?.id) return json.data;
  const told = json?.message ?? json?.error?.message;
  const message = response.status === 422 && told ? `마이인이 받지 않았어요: ${told}` : MESSAGES[response.status] ?? "마이인에 보내지 못했어요. 잠시 뒤 다시 해 주세요.";
  // A key or server problem on MYIN's side is not the person's request: it comes back as a bad gateway with the reason.
  throw new ApiError(response.status === 401 || response.status === 403 || response.status >= 500 ? 502 : response.status, `MYIN_${response.status}`, message);
}
