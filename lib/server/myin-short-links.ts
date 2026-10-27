import { z } from "zod";
import { ApiError } from "@/lib/http";

// 마이인 단축 링크 (owner decision 2026-10-26: 「마이인 단축 링크로 어떤 링크도, 직원 코드 없이, 언제든」): the MYIN server makes
// https://www.myinlab.co.kr/r/<key> for any https address, through the same OS integration key as the column push (myin-articles).
export const shortLinkSchema = z.object({ url: z.string().trim().url().max(2000).refine(url => url.startsWith("https://"), "https:// 주소만 줄일 수 있어요."), label: z.string().trim().max(80).default("") }).strict();
export interface MyinShortLink { key: string; url: string; target: string; label: string; createdAt: string; created?: boolean }

async function myinLinks<T>(method: "GET" | "POST", body?: unknown): Promise<T> {
  const base = process.env.MYIN_API_BASE?.trim().replace(/\/+$/, ""), secret = process.env.MYIN_OS_ARTICLE_SECRET?.trim();
  if (!base || !secret) throw new ApiError(503, "MYIN_NOT_CONFIGURED", "마이인 연결 설정이 아직 없어요. 관리자에게 알려 주세요.");
  let response: Response;
  try {
    response = await fetch(`${base}/api/integrations/brandy-os/links`, { method, headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", signal: AbortSignal.timeout(15_000) });
  } catch { throw new ApiError(502, "MYIN_UNREACHABLE", "마이인에 연결하지 못했어요. 잠시 뒤 다시 해 주세요."); }
  const json = await response.json().catch(() => null) as { data?: T; message?: string } | null;
  if (response.ok && json?.data) return json.data;
  if (response.status === 422 && json?.message) throw new ApiError(422, "MYIN_422", `마이인이 받지 않았어요: ${json.message}`);
  // MYIN without this feature yet (before its deploy and migration) answers 404/500: say so plainly.
  throw new ApiError(502, `MYIN_${response.status}`, response.status === 401 || response.status === 403 ? "마이인 연결 키가 맞지 않아요. 관리자에게 알려 주세요."
    : "마이인 단축 링크를 만들지 못했어요. 잠시 뒤 다시 해 주세요.");
}

/** The same address gives back the link MYIN already has for it. `by` is the OS user id, not a name or email. */
export const makeMyinShortLink = (input: z.infer<typeof shortLinkSchema>, by: string) => myinLinks<MyinShortLink>("POST", { target: input.url, label: input.label, by: `os:${by}` });
export const listMyinShortLinks = () => myinLinks<{ items: MyinShortLink[] }>("GET").then(result => result.items);
