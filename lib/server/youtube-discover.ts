import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { decodeHtmlEntities } from "@/lib/html-entities";
import { createServiceSupabase } from "@/lib/supabase/server";
import {
  categoryQuery, channelNormal, DISCOVER_LETTERS, isBreakout, isLongform, KOREAN, NOT_A_TOPIC, rankPackagingRefs,
  type DiscoverChannel, type DiscoverLetter, type DiscoverVideo, type PackagingRef,
} from "@/lib/youtube-process/discover";
import type { RequestActor } from "./auth";
import { keepFoundBreakouts } from "./youtube-niche";

// 유튜브 공정 v1 주제 찾기 (the 기획실 concept): a category or keyword search, then each found channel's normal — the median of
// its recent long uploads — so a video counts as 터진 영상 against its own channel, and each channel shows how often it breaks out.
// Quota: a search is 100 units (50 results cost the same as fewer); each channel's last 50 uploads are 2 units. Results are shared
// for 12 hours, so a category clicked again — or 전체, twelve searches — does not spend the daily quota twice.
const CACHE_HOURS = 12;
const CACHE_KIND = "youtube_discover_cache";
const MAX_CHANNELS = 120;
export const discoverSchema = z.object({
  category: z.enum(["all", ...DISCOVER_LETTERS] as [string, ...string[]]).optional(),
  q: z.string().trim().min(2).max(120).optional(),
  days: z.enum(["30", "90", "365", "all"]).default("365"),
  refresh: z.boolean().default(false),
}).refine(input => Boolean(input.category) !== Boolean(input.q), "분류나 검색어 하나를 골라 주세요.");

type Snippet = { title?: string; channelId?: string; channelTitle?: string; publishedAt?: string; liveBroadcastContent?: string; thumbnails?: { medium?: { url?: string }; high?: { url?: string } } };
type Video = { id?: string; snippet?: Snippet; statistics?: { viewCount?: string; likeCount?: string }; contentDetails?: { duration?: string }; liveStreamingDetails?: unknown };
type Channel = { id?: string; snippet?: { title?: string; customUrl?: string }; statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean }; contentDetails?: { relatedPlaylists?: { uploads?: string } } };
const seconds = (value = "") => { const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/); return match ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0) : 0; };
async function youtube<T>(path: string, params: Record<string, string>, key: string) {
  const response = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...params, key })}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const body = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new ApiError(502, "YOUTUBE_SEARCH_FAILED", "유튜브에서 영상을 불러오지 못했어요. 잠시 후 다시 찾아 주세요.", body.error?.message);
  return body;
}
const chunks = <T,>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, index * size + size));
const VIDEO_PARTS = "snippet,statistics,contentDetails,liveStreamingDetails";
const asVideo = (video: Video, channel: { subscribers: number | null; median: number | null } | undefined, query?: string): DiscoverVideo => {
  const id = video.id ?? ""; const viewCount = Number(video.statistics?.viewCount ?? 0);
  const subscribers = channel?.subscribers ?? null; const median = channel?.median ?? null;
  return { id, title: decodeHtmlEntities(video.snippet?.title ?? "제목 없음"), channelId: video.snippet?.channelId ?? "", channelTitle: decodeHtmlEntities(video.snippet?.channelTitle ?? ""),
    viewCount, subscribers, durationSeconds: seconds(video.contentDetails?.duration), publishedAt: video.snippet?.publishedAt ?? null,
    thumbnail: video.snippet?.thumbnails?.high?.url ?? video.snippet?.thumbnails?.medium?.url ?? "", url: `https://www.youtube.com/watch?v=${id}`,
    median, ratio: median ? Math.round(viewCount / median * 10) / 10 : null, viewSubscriberRatio: subscribers ? Math.round(viewCount / subscribers * 100) / 100 : null, ...(query ? { query } : {}) };
};

/** A reference pasted by address on 주제 (로건 피드백 10/26-3): its title · channel, written like a 주제 찾기 reference (1 unit). */
export async function referenceTitle(videoId: string) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new ApiError(503, "YOUTUBE_NOT_CONFIGURED", "유튜브 검색 연결이 없어요.");
  const { items } = await youtube<{ items?: Video[] }>("videos", { part: "snippet", id: videoId }, key);
  const snippet = items?.[0]?.snippet;
  if (!snippet?.title) throw new ApiError(404, "YOUTUBE_VIDEO_NOT_FOUND", "영상을 찾지 못했어요.");
  return { title: `${decodeHtmlEntities(snippet.title)} · ${decodeHtmlEntities(snippet.channelTitle ?? "")}`.slice(0, 200) };
}

/** 패키징 레퍼런스 for the 기획안 · 최종 썸네일 jobs: the 기획실's one search (about 102 units), ranked by rankPackagingRefs. */
/** short: 숏폼 참고 영상 — YouTube's own under-4-minute filter, so more of the 50 results are Shorts. */
export async function packagingReferences(query: string, short = false): Promise<PackagingRef[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new ApiError(503, "YOUTUBE_NOT_CONFIGURED", "YouTube Data API 키가 아직 연결되지 않았습니다.");
  const found = await youtube<{ items?: { id?: { videoId?: string } }[] }>("search", { part: "snippet", q: query, type: "video", maxResults: "50", order: "relevance", relevanceLanguage: "ko", regionCode: "KR", safeSearch: "none", ...(short ? { videoDuration: "short" } : {}) }, key);
  const ids = (found.items ?? []).map(item => item.id?.videoId).filter((id): id is string => Boolean(id));
  if (!ids.length) return [];
  const videos = (await youtube<{ items?: Video[] }>("videos", { part: VIDEO_PARTS, id: ids.join(",") }, key)).items ?? [];
  const channelIds = [...new Set(videos.map(video => video.snippet?.channelId).filter((id): id is string => Boolean(id)))];
  const channels = channelIds.length ? (await youtube<{ items?: Channel[] }>("channels", { part: "statistics", id: channelIds.join(",") }, key)).items ?? [] : [];
  const subscribers = new Map(channels.map(row => [row.id, row.statistics?.hiddenSubscriberCount ? null : Number(row.statistics?.subscriberCount ?? 0) || null]));
  return rankPackagingRefs(videos.map(video => ({ id: video.id ?? "", title: decodeHtmlEntities(video.snippet?.title ?? ""), channel: decodeHtmlEntities(video.snippet?.channelTitle ?? ""),
    views: Number(video.statistics?.viewCount ?? 0), subscribers: subscribers.get(video.snippet?.channelId) ?? null, seconds: seconds(video.contentDetails?.duration),
    live: (video.snippet?.liveBroadcastContent ?? "none") !== "none", likes: video.statistics?.likeCount === undefined ? null : Number(video.statistics.likeCount) })));
}

/** A channel's subscribers, normal views and breakouts from its last 50 uploads (2 quota units). */
async function channelStats(row: Channel, key: string): Promise<DiscoverChannel> {
  const subscribers = row.statistics?.hiddenSubscriberCount ? null : Number(row.statistics?.subscriberCount ?? 0) || null;
  const playlistId = row.contentDetails?.relatedPlaylists?.uploads;
  const items = playlistId ? (await youtube<{ items?: { contentDetails?: { videoId?: string } }[] }>("playlistItems", { part: "contentDetails", playlistId, maxResults: "50" }, key).catch(() => ({ items: [] }))).items ?? [] : [];
  const ids = items.map(item => item.contentDetails?.videoId).filter((id): id is string => Boolean(id));
  const raw = ids.length ? (await youtube<{ items?: Video[] }>("videos", { part: VIDEO_PARTS, id: ids.join(",") }, key).catch(() => ({ items: [] as Video[] }))).items ?? [] : [];
  const median = channelNormal(raw.map(video => ({ views: Number(video.statistics?.viewCount ?? 0), durationSeconds: seconds(video.contentDetails?.duration), title: video.snippet?.title ?? "", live: Boolean(video.liveStreamingDetails) })));
  const breakouts = raw.map(video => asVideo(video, { subscribers, median })).filter(isBreakout).sort((a, b) => b.ratio! - a.ratio!);
  return { id: row.id ?? "", title: decodeHtmlEntities(row.snippet?.title ?? ""), url: row.snippet?.customUrl ? `https://www.youtube.com/${row.snippet.customUrl}` : `https://www.youtube.com/channel/${row.id}`,
    subscribers, median, breakouts: breakouts.length, best: breakouts[0]?.ratio ?? null, top: breakouts.slice(0, 3) };
}

export async function discoverYoutube(actor: RequestActor, input: z.infer<typeof discoverSchema>) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new ApiError(503, "YOUTUBE_NOT_CONFIGURED", "YouTube Data API 키가 아직 연결되지 않았습니다.");
  const cacheKey = createHash("sha256").update(JSON.stringify(["v4", input.category ?? "", input.q ?? "", input.days, "KR"])).digest("hex");
  const service = createServiceSupabase();
  if (!input.refresh) {
    const { data } = await service.from("os_records").select("metadata").eq("record_type", "content_package").eq("metadata->>packageKind", CACHE_KIND)
      .eq("metadata->>cacheKey", cacheKey).gte("created_at", new Date(Date.now() - CACHE_HOURS * 3_600_000).toISOString()).is("archived_at", null)
      .order("created_at", { ascending: false }).limit(1);
    const hit = data?.[0]?.metadata as { at?: string; videos?: DiscoverVideo[]; channels?: DiscoverChannel[] } | undefined;
    if (hit?.videos && hit.channels) return { videos: hit.videos, channels: hit.channels, at: hit.at ?? "", cached: true };
  }
  const letters: (DiscoverLetter | null)[] = input.q ? [null] : input.category === "all" ? DISCOVER_LETTERS : [input.category as DiscoverLetter];
  const after: Record<string, string> = input.days === "all" ? {} : { publishedAfter: new Date(Date.now() - Number(input.days) * 86_400_000).toISOString() };
  const searches = await Promise.all(letters.map(letter => {
    const q = letter ? categoryQuery(letter) : input.q!;
    return youtube<{ items?: { id?: { videoId?: string }; snippet?: Snippet }[] }>("search", { part: "snippet", type: "video", order: "viewCount", regionCode: "KR", relevanceLanguage: "ko", maxResults: "50", q, ...after }, key)
      .then(body => (body.items ?? []).map(item => ({ id: item.id?.videoId ?? "", title: decodeHtmlEntities(item.snippet?.title ?? ""), query: letter ?? input.q! })));
  }));
  // Searches count Korean titles only; background sound and playlists answer no topic.
  const queryOf = new Map<string, string>();
  for (const item of searches.flat()) if (item.id && !queryOf.has(item.id) && KOREAN.test(item.title) && !NOT_A_TOPIC.test(item.title)) queryOf.set(item.id, item.query);
  const videos = (await Promise.all(chunks([...queryOf.keys()], 50).map(ids => youtube<{ items?: Video[] }>("videos", { part: VIDEO_PARTS, id: ids.join(",") }, key))))
    .flatMap(body => body.items ?? []).filter(video => video.statistics && !video.liveStreamingDetails);
  // The channels behind the most-watched found videos first, at most MAX_CHANNELS of them.
  const topViews = new Map<string, number>();
  for (const video of videos) { const id = video.snippet?.channelId; if (id) topViews.set(id, Math.max(topViews.get(id) ?? 0, Number(video.statistics?.viewCount ?? 0))); }
  const channelIds = [...topViews.keys()].sort((a, b) => topViews.get(b)! - topViews.get(a)!).slice(0, MAX_CHANNELS);
  const rows = (await Promise.all(chunks(channelIds, 50).map(ids => youtube<{ items?: Channel[] }>("channels", { part: "snippet,statistics,contentDetails", id: ids.join(",") }, key)))).flatMap(body => body.items ?? []);
  const channels = await Promise.all(rows.map(row => channelStats(row, key)));
  const byId = new Map(channels.map(channel => [channel.id, channel]));
  const kept = {
    videos: videos.map(video => asVideo(video, byId.get(video.snippet?.channelId ?? ""), queryOf.get(video.id ?? ""))).filter(isLongform),
    channels: channels.filter(channel => channel.median !== null).sort((a, b) => b.breakouts - a.breakouts || (b.best ?? 0) - (a.best ?? 0)),
  };
  const at = new Date().toISOString();
  // The search's 터진 영상 and each channel's best stay as 틈새 재료 after the 12-hour cache.
  await keepFoundBreakouts(service, actor, [...kept.videos.filter(isBreakout), ...kept.channels.flatMap(channel => channel.top)]);
  // ponytail: one cache row per fresh search, never cleaned up; archive rows older than a week if they pile up.
  await service.from("os_records").insert({ record_type: "content_package", title: `주제 찾기 · ${input.q ?? input.category}`, description: "", status: "done", priority: "normal",
    owner_id: actor.ownerId, created_by: actor.ownerId, updated_by: actor.ownerId, team: actor.team, tags: ["주제찾기"],
    metadata: { packageKind: CACHE_KIND, cacheKey, query: { category: input.category ?? null, q: input.q ?? null, days: input.days }, at, ...kept } });
  return { ...kept, at, cached: false };
}
