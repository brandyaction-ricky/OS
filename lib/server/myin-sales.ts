import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { videoSales, type SalesMaps, type SalesRow, type VideoSales } from "@/lib/video-sales";

// 마이인 영상별 매출 (OS 개발 요청 2026-11-11): MYIN's money per UTM combination (counts and won only — no person, no order id),
// through the same server-to-server key as the 단축 링크 and the column push, matched to videos here. The OS keeps the
// video ↔ code map (its uploads' codes, YouTube ids); MYIN keeps the orders. Five minutes per range; a failed read shows the
// last good one marked late instead of zero.
// ponytail: the cache is per server instance; a shared store when several instances disagree visibly.
const TTL_MS = 5 * 60_000;
type Result = VideoSales & { from: string; to: string; measuredAt: string; stale?: { reason: string } };
const cache = new Map<string, { at: number; value: Result }>();

async function myinSales(from: string, to: string): Promise<{ rows: SalesRow[]; measuredAt: string }> {
  const base = process.env.MYIN_API_BASE?.trim().replace(/\/+$/, ""), secret = process.env.MYIN_OS_ARTICLE_SECRET?.trim();
  if (!base || !secret) throw new ApiError(503, "MYIN_NOT_CONFIGURED", "마이인 연결 설정이 아직 없어요. 관리자에게 알려 주세요.");
  let response: Response;
  try {
    response = await fetch(`${base}/api/integrations/brandy-os/sales?${new URLSearchParams({ from, to })}`, { headers: { authorization: `Bearer ${secret}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  } catch { throw new ApiError(502, "MYIN_UNREACHABLE", "마이인에 연결하지 못했어요. 잠시 뒤 다시 해 주세요."); }
  const json = await response.json().catch(() => null) as { data?: { rows?: SalesRow[]; measuredAt?: string }; message?: string } | null;
  if (response.ok && Array.isArray(json?.data?.rows)) return { rows: json.data.rows, measuredAt: json.data.measuredAt ?? new Date().toISOString() };
  if (response.status === 404) throw new ApiError(503, "MYIN_SALES_NOT_READY", "마이인에 영상별 매출 연결이 아직 없어요(마이인 배포 대기).");
  if (response.status === 401 || response.status === 403) throw new ApiError(502, "MYIN_AUTH", "마이인 연결 키가 맞지 않아요. 관리자에게 알려 주세요.");
  if (response.status === 422 && json?.message) throw new ApiError(422, "MYIN_422", `마이인이 받지 않았어요: ${json.message}`);
  throw new ApiError(502, `MYIN_${response.status}`, "마이인 매출을 불러오지 못했어요. 잠시 뒤 다시 해 주세요.");
}

/** The OS's own uploads (their yp- codes and video ids), then any other id-looking code looked up on YouTube for its title. */
async function salesMaps(rows: SalesRow[]): Promise<SalesMaps> {
  const maps: SalesMaps = { codes: {}, videos: {} };
  const { data, error } = await createServiceSupabase().from("os_records").select("title,metadata").eq("record_type", "content_publish").not("metadata->>youtubeVideoId", "is", null).limit(3000);
  if (error) throw new ApiError(503, "VIDEO_MAP_UNAVAILABLE", "영상 연결 정보를 읽지 못했어요.");
  for (const row of data ?? []) {
    const id = String(row.metadata?.youtubeVideoId ?? ""), code = String(row.metadata?.utmContent ?? "");
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) continue;
    maps.videos[id] ??= { videoId: id, title: row.title || "제목 확인 필요" };
    if (/^yp-[0-9a-f]{8}$/.test(code)) maps.codes[code] = [...new Set([...(maps.codes[code] ?? []), id])];
  }
  const unknown = [...new Set(rows.map((row) => row.cnt ?? "").filter((cnt) => /^[A-Za-z0-9_-]{11}$/.test(cnt) && !maps.videos[cnt]))];
  const key = process.env.YOUTUBE_API_KEY?.trim();
  for (let i = 0; key && i < unknown.length; i += 50) {
    const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: "snippet", id: unknown.slice(i, i + 50).join(","), key })}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) }).catch(() => null);
    const body = await response?.json().catch(() => null) as { items?: { id?: string; snippet?: { title?: string; channelTitle?: string } }[] } | null;
    for (const item of body?.items ?? []) if (item.id) maps.videos[item.id] = { videoId: item.id, title: item.snippet?.title || "제목 확인 필요", channelTitle: item.snippet?.channelTitle };
  }
  return maps;
}

export async function readVideoSales(from: string, to: string, fresh = false): Promise<Result> {
  const key = `${from}|${to}`, hit = cache.get(key);
  if (hit && !fresh && Date.now() - hit.at < TTL_MS) return hit.value;
  try {
    const { rows, measuredAt } = await myinSales(from, to);
    const value: Result = { from, to, measuredAt, ...videoSales(rows, await salesMaps(rows)) };
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (error) {
    if (hit) return { ...hit.value, stale: { reason: error instanceof Error ? error.message : "마이인 매출을 불러오지 못했어요." } };
    throw error;
  }
}
