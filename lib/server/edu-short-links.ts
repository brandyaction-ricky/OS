import { z } from "zod";
import { ApiError } from "@/lib/http";

// 에듀 단축 링크 (2026-11-08): https://brandyaction-edu.com/go/<key> shortens any https address (a long UTM link, a site page)
// and keeps its address while staff change where it goes, so it doubles as a fixed link. Only the address is required.
// The EDU server owns the links and counts the clicks; OS makes, lists and changes them over EDU's integration route.
const https = z.string().trim().url().max(2000).refine(url => url.startsWith("https://"), "https:// 주소만 넣을 수 있어요.");
const key = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/, "주소 끝부분은 영어 소문자·숫자·- 로 2~40자예요.");
const label = z.string().trim().max(80), channel = z.string().trim().max(40);
export const eduLinkCreateSchema = z.object({ url: https, label: label.default(""), channel: channel.default(""), key: key.optional().or(z.literal("")) }).strict();
export const eduLinkPatchSchema = z.object({ key, url: https.optional(), label: label.optional(), channel: channel.optional(), active: z.boolean().optional() }).strict();
export interface EduShortLink { key: string; url: string; target: string; label: string; channel: string; active: boolean; clicks: number; lastClickedAt: string | null; createdAt: string; updatedAt: string; created?: boolean }

async function eduLinks<T>(method: "GET" | "POST" | "PATCH", body?: unknown): Promise<T> {
  const base = process.env.EDU_API_BASE?.trim().replace(/\/+$/, ""), secret = process.env.EDU_OS_LINKS_SECRET?.trim();
  if (!base || !secret) throw new ApiError(503, "EDU_NOT_CONFIGURED", "에듀 연결 설정이 아직 없어요. 관리자에게 알려 주세요.");
  let response: Response;
  try {
    response = await fetch(`${base}/api/integrations/brandy-os/links`, { method, headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", signal: AbortSignal.timeout(15_000) });
  } catch { throw new ApiError(502, "EDU_UNREACHABLE", "에듀에 연결하지 못했어요. 잠시 뒤 다시 해 주세요."); }
  const json = await response.json().catch(() => null) as { data?: T; message?: string } | null;
  if (response.ok && json?.data) return json.data;
  // EDU says in plain Korean why it refused an input (없는 주소, 이미 쓰는 주소, 잘못된 도착지): pass that on as is.
  if ([404, 409, 413, 422].includes(response.status) && json?.message) throw new ApiError(response.status, `EDU_${response.status}`, json.message);
  throw new ApiError(502, `EDU_${response.status}`, response.status === 401 || response.status === 403 ? "에듀 연결 키가 맞지 않아요. 관리자에게 알려 주세요."
    : "에듀 단축 링크를 처리하지 못했어요. 잠시 뒤 다시 해 주세요.");
}

/** `by` is the OS user id, not a name or email. The same address (with the same name and channel) gives back the link EDU already has. */
export const makeEduLink = ({ url, label, channel, key }: z.infer<typeof eduLinkCreateSchema>, by: string) =>
  eduLinks<EduShortLink>("POST", { target: url, label, channel, ...(key ? { key } : {}), by: `os:${by}` });
export const listEduLinks = () => eduLinks<{ items: EduShortLink[] }>("GET").then(result => result.items);
export const changeEduLink = ({ url, ...rest }: z.infer<typeof eduLinkPatchSchema>) => eduLinks<EduShortLink>("PATCH", { ...rest, ...(url ? { target: url } : {}) });
