import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { decodeHtmlEntities } from "@/lib/html-entities";
import { createServiceSupabase } from "@/lib/supabase/server";
import { categoryQuery, DISCOVER_LETTERS, type DiscoverLetter, type DiscoverVideo } from "@/lib/youtube-process/discover";
import type { RequestActor } from "./auth";

// 유튜브 공정 v1 주제 찾기: one search per category (or the keyword), the videos' and channels' numbers, and a 12-hour shared cache
// so a category clicked again — or 전체, twelve searches at 100 quota units each — does not spend the daily YouTube quota twice.
// The search itself follows app/api/v1/youtube/search/route.ts.
const CACHE_HOURS = 12;
const CACHE_KIND = "youtube_discover_cache";
export const discoverSchema = z.object({
  category: z.enum(["all", ...DISCOVER_LETTERS] as [string, ...string[]]).optional(),
  q: z.string().trim().min(2).max(120).optional(),
  days: z.enum(["30", "90", "365", "all"]).default("365"),
  refresh: z.boolean().default(false),
}).refine(input => Boolean(input.category) !== Boolean(input.q), "분류나 검색어 하나를 골라 주세요.");

type SearchItem = { id?: { videoId?: string }; snippet?: { title?: string; channelId?: string; channelTitle?: string; publishedAt?: string; thumbnails?: { medium?: { url?: string }; high?: { url?: string } } } };
const seconds = (value = "") => { const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/); return match ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0) : 0; };
async function youtube<T>(path: string, params: Record<string, string>, key: string) {
  const response = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...params, key })}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const body = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new ApiError(502, "YOUTUBE_SEARCH_FAILED", "유튜브에서 영상을 불러오지 못했어요. 잠시 후 다시 찾아 주세요.", body.error?.message);
  return body;
}
const chunks = <T,>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, index * size + size));

export async function discoverYoutube(actor: RequestActor, input: z.infer<typeof discoverSchema>) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new ApiError(503, "YOUTUBE_NOT_CONFIGURED", "YouTube Data API 키가 아직 연결되지 않았습니다.");
  const cacheKey = createHash("sha256").update(JSON.stringify(["v1", input.category ?? "", input.q ?? "", input.days, "KR"])).digest("hex");
  const service = createServiceSupabase();
  if (!input.refresh) {
    const { data } = await service.from("os_records").select("metadata").eq("record_type", "content_package").eq("metadata->>packageKind", CACHE_KIND)
      .eq("metadata->>cacheKey", cacheKey).gte("created_at", new Date(Date.now() - CACHE_HOURS * 3_600_000).toISOString()).is("archived_at", null)
      .order("created_at", { ascending: false }).limit(1);
    const hit = data?.[0]?.metadata as { at?: string; items?: DiscoverVideo[] } | undefined;
    if (hit?.items) return { items: hit.items, at: hit.at ?? "", cached: true };
  }
  const letters: (DiscoverLetter | null)[] = input.q ? [null] : input.category === "all" ? DISCOVER_LETTERS : [input.category as DiscoverLetter];
  const after: Record<string, string> = input.days === "all" ? {} : { publishedAfter: new Date(Date.now() - Number(input.days) * 86_400_000).toISOString() };
  const searches = await Promise.all(letters.map(letter => youtube<{ items?: SearchItem[] }>("search", {
    part: "snippet", type: "video", order: "viewCount", regionCode: "KR", relevanceLanguage: "ko", maxResults: input.category === "all" ? "15" : "25",
    q: letter ? categoryQuery(letter) : input.q!, ...after,
  }, key).then(body => (body.items ?? []).map(item => ({ item, letter })))));
  const seen = new Set<string>();
  const found = searches.flat().filter(({ item }) => { const id = item.id?.videoId; if (!id || seen.has(id)) return false; seen.add(id); return true; });
  const videoIds = found.map(({ item }) => item.id!.videoId!);
  const channelIds = [...new Set(found.map(({ item }) => item.snippet?.channelId).filter((id): id is string => Boolean(id)))];
  const [videos, channels] = await Promise.all([
    Promise.all(chunks(videoIds, 50).map(ids => youtube<{ items?: { id?: string; statistics?: { viewCount?: string }; contentDetails?: { duration?: string }; liveStreamingDetails?: unknown }[] }>("videos", { part: "statistics,contentDetails,liveStreamingDetails", id: ids.join(",") }, key))),
    Promise.all(chunks(channelIds, 50).map(ids => youtube<{ items?: { id?: string; statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean } }[] }>("channels", { part: "statistics", id: ids.join(",") }, key))),
  ]);
  const videoById = new Map(videos.flatMap(body => body.items ?? []).map(item => [item.id, item]));
  const channelById = new Map(channels.flatMap(body => body.items ?? []).map(item => [item.id, item.statistics]));
  const items: DiscoverVideo[] = found.flatMap(({ item, letter }) => {
    const id = item.id!.videoId!; const video = videoById.get(id);
    // Live streams and videos whose numbers did not come back are left out rather than shown as 0.
    if (!video?.statistics || video.liveStreamingDetails) return [];
    const channel = channelById.get(item.snippet?.channelId ?? "");
    const subscribers = channel?.hiddenSubscriberCount ? null : Number(channel?.subscriberCount ?? 0) || null;
    const viewCount = Number(video.statistics.viewCount ?? 0);
    return [{ id, title: decodeHtmlEntities(item.snippet?.title ?? "제목 없음"), channelTitle: decodeHtmlEntities(item.snippet?.channelTitle ?? ""), viewCount, subscribers,
      viewSubscriberRatio: subscribers ? Math.round(viewCount / subscribers * 100) / 100 : null, durationSeconds: seconds(video.contentDetails?.duration),
      publishedAt: item.snippet?.publishedAt ?? null, thumbnail: item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.medium?.url ?? "",
      url: `https://www.youtube.com/watch?v=${id}`, ...(letter ? { category: letter } : {}) }];
  });
  const at = new Date().toISOString();
  // ponytail: one cache row per fresh search, never cleaned up; archive rows older than a week if they pile up.
  await service.from("os_records").insert({ record_type: "content_package", title: `주제 찾기 · ${input.q ?? input.category}`, description: "", status: "done", priority: "normal",
    owner_id: actor.ownerId, created_by: actor.ownerId, updated_by: actor.ownerId, team: actor.team, tags: ["주제찾기"],
    metadata: { packageKind: CACHE_KIND, cacheKey, query: { category: input.category ?? null, q: input.q ?? null, days: input.days }, at, items } });
  return { items, at, cached: false };
}
