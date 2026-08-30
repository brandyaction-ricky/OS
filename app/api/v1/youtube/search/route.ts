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
  snippet?: { title?: string; channelTitle?: string; publishedAt?: string; thumbnails?: { medium?: { url?: string }; high?: { url?: string } } };
}
interface YoutubeVideoItem { id?: string; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }

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
    const videoParams = new URLSearchParams({ part: "statistics", id: ids.join(","), key });
    const videoResponse = await fetch(`https://www.googleapis.com/youtube/v3/videos?${videoParams}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const videoBody = await videoResponse.json() as { items?: YoutubeVideoItem[] };
    const statistics = new Map((videoBody.items ?? []).map((item) => [item.id, item.statistics]));
    const items = searchItems.map((item) => {
      const id = item.id?.videoId ?? ""; const stats = statistics.get(id);
      return { id, title: item.snippet?.title ?? "제목 없음", channelTitle: item.snippet?.channelTitle ?? "", publishedAt: item.snippet?.publishedAt ?? null, thumbnail: item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.medium?.url ?? "", viewCount: Number(stats?.viewCount ?? 0), likeCount: Number(stats?.likeCount ?? 0), commentCount: Number(stats?.commentCount ?? 0), url: `https://www.youtube.com/watch?v=${id}` };
    });
    return NextResponse.json({ query: input.q, configured: true, items });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_YOUTUBE_QUERY", "검색어를 두 글자 이상 입력해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
