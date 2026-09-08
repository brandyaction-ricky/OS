import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { outlierBaseline, type BaselineVideo } from "@/lib/youtube-outliers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
type Item = { id?: string; snippet?: { channelId?: string; title?: string; publishedAt?: string; categoryId?: string; liveBroadcastContent?: string }; statistics?: { viewCount?: string }; contentDetails?: { duration?: string; relatedPlaylists?: { uploads?: string }; videoId?: string }; liveStreamingDetails?: unknown };
async function youtube(resource: string, parameters: Record<string, string>) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new ApiError(503, "YOUTUBE_NOT_CONFIGURED", "YouTube Data API 연결이 필요합니다.");
  const response = await fetch(`https://www.googleapis.com/youtube/v3/${resource}?${new URLSearchParams({ ...parameters, key })}`, { next: { revalidate: 1800 }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new ApiError(502, "YOUTUBE_BASELINE_FAILED", "동일 채널 비교 데이터를 불러오지 못했습니다.");
  return await response.json() as { items?: Item[]; nextPageToken?: string };
}
function normalize(item: Item): BaselineVideo {
  const duration = item.contentDetails?.duration?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  return { id: item.id ?? "", channelId: item.snippet?.channelId ?? "", title: item.snippet?.title ?? "", publishedAt: item.snippet?.publishedAt ?? "", views: Number(item.statistics?.viewCount ?? 0), durationSeconds: duration ? Number(duration[1] ?? 0) * 3600 + Number(duration[2] ?? 0) * 60 + Number(duration[3] ?? 0) : 0, live: !!item.liveStreamingDetails || ["live", "upcoming"].includes(item.snippet?.liveBroadcastContent ?? ""), categoryId: item.snippet?.categoryId };
}
export async function GET(request: Request) {
  try {
    await authenticateRequest(request);
    const id = z.string().regex(/^[A-Za-z0-9_-]{11}$/).parse(new URL(request.url).searchParams.get("videoId"));
    const part = "snippet,statistics,contentDetails,liveStreamingDetails";
    const raw = (await youtube("videos", { part, id })).items?.[0];
    if (!raw) throw new ApiError(404, "VIDEO_NOT_FOUND", "영상을 찾지 못했습니다.");
    const target = normalize(raw);
    const channel = (await youtube("channels", { part: "contentDetails", id: target.channelId })).items?.[0];
    const playlist = channel?.contentDetails?.relatedPlaylists?.uploads;
    if (!playlist) throw new ApiError(404, "UPLOADS_NOT_FOUND", "채널 업로드 목록을 찾지 못했습니다.");
    const candidates: BaselineVideo[] = []; let nextPageToken = "";
    // Bounded scan: at most 150 uploads, stopping as soon as 20 comparable videos exist.
    for (let page = 0; page < 3; page++) {
      const uploads = await youtube("playlistItems", { part: "contentDetails", playlistId: playlist, maxResults: "50", ...(nextPageToken ? { pageToken: nextPageToken } : {}) });
      const ids = (uploads.items ?? []).map((item) => item.contentDetails?.videoId).filter(Boolean).join(",");
      if (ids) candidates.push(...((await youtube("videos", { part, id: ids })).items ?? []).map(normalize));
      nextPageToken = uploads.nextPageToken ?? "";
      if (!nextPageToken || outlierBaseline(target, candidates).sampleCount >= 20) break;
    }
    return NextResponse.json({ videoId: id, ...outlierBaseline(target, candidates), scanned: candidates.length, measuredAt: new Date().toISOString() });
  } catch (error) { return apiErrorResponse(error); }
}
