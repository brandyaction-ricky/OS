import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().min(2).max(120),
  maxResults: z.coerce.number().int().min(1).max(20).default(12),
});

interface YoutubeSearchItem {
  id?: { videoId?: string };
  snippet?: { title?: string; channelId?: string; channelTitle?: string; publishedAt?: string; thumbnails?: { medium?: { url?: string }; high?: { url?: string } } };
}
interface YoutubeVideoItem { id?: string; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string }; contentDetails?: { duration?: string } }
interface YoutubeChannelItem { id?: string; statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean } }

function durationSeconds(value = "") {
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  return match ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0) : 0;
}

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) throw new ApiError(503, "YOUTUBE_NOT_CONFIGURED", "YouTube Data API 키가 아직 연결되지 않았습니다.");
    const url = new URL(request.url);
    const input = querySchema.parse({ q: url.searchParams.get("q"), maxResults: url.searchParams.get("maxResults") ?? 12 });
    const searchParams = new URLSearchParams({ part: "snippet", type: "video", order: "viewCount", relevanceLanguage: "ko", regionCode: "KR", maxResults: String(input.maxResults), q: input.q, key });
    const searchResponse = await fetch(`https://www.googleapis.com/youtube/v3/search?${searchParams}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const searchBody = await searchResponse.json() as { items?: YoutubeSearchItem[]; error?: { message?: string } };
    if (!searchResponse.ok) throw new ApiError(502, "YOUTUBE_SEARCH_FAILED", "YouTube 시장 영상을 불러오지 못했습니다.", searchBody.error?.message);
    const searchItems = searchBody.items ?? [];
    const ids = searchItems.map((item) => item.id?.videoId).filter((id): id is string => Boolean(id));
    if (!ids.length) return NextResponse.json({ query: input.q, items: [], configured: true });
    const channelIds = [...new Set(searchItems.map((item) => item.snippet?.channelId).filter((id): id is string => Boolean(id)))];
    const videoParams = new URLSearchParams({ part: "statistics,contentDetails", id: ids.join(","), key });
    const channelParams = new URLSearchParams({ part: "statistics", id: channelIds.join(","), key });
    const [videoResponse, channelResponse] = await Promise.all([
      fetch(`https://www.googleapis.com/youtube/v3/videos?${videoParams}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) }),
      channelIds.length ? fetch(`https://www.googleapis.com/youtube/v3/channels?${channelParams}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) }) : null,
    ]);
    const videoBody = await videoResponse.json() as { items?: YoutubeVideoItem[] };
    const channelBody = channelResponse ? await channelResponse.json() as { items?: YoutubeChannelItem[] } : { items: [] };
    const statistics = new Map((videoBody.items ?? []).map((item) => [item.id, item.statistics]));
    const details = new Map((videoBody.items ?? []).map((item) => [item.id, item.contentDetails]));
    const channelStats = new Map((channelBody.items ?? []).map((item) => [item.id, item.statistics]));
    const items = searchItems.map((item) => {
      const id = item.id?.videoId ?? ""; const stats = statistics.get(id); const channel = channelStats.get(item.snippet?.channelId ?? "");
      const subscribers = channel?.hiddenSubscriberCount ? null : Number(channel?.subscriberCount ?? 0) || null;
      const viewCount = Number(stats?.viewCount ?? 0);
      return { id, title: item.snippet?.title ?? "제목 없음", channelTitle: item.snippet?.channelTitle ?? "", publishedAt: item.snippet?.publishedAt ?? null, thumbnail: item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.medium?.url ?? "", viewCount, likeCount: Number(stats?.likeCount ?? 0), commentCount: Number(stats?.commentCount ?? 0), durationSeconds: durationSeconds(details.get(id)?.duration), subscribers, viewSubscriberRatio: subscribers ? Number((viewCount / subscribers).toFixed(2)) : null, url: `https://www.youtube.com/watch?v=${id}` };
    });
    return NextResponse.json({ query: input.q, configured: true, items });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_YOUTUBE_QUERY", "검색어를 두 글자 이상 입력해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
