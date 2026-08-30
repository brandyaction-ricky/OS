import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ q: z.string().trim().min(2).max(300) });

function channelLookup(raw: string) {
  const id = raw.match(/(?:^|\/)(UC[\w-]{22})(?:$|[/?#])/)?.[1] ?? (raw.match(/^(UC[\w-]{22})$/)?.[1]);
  if (id) return { id };
  const handle = raw.match(/@([\w.\-가-힣]+)/)?.[1] ?? raw.match(/^([\w.\-가-힣]+)$/)?.[1];
  if (handle) return { forHandle: handle };
  throw new ApiError(400, "INVALID_YOUTUBE_CHANNEL", "YouTube 채널 URL, @핸들 또는 채널 ID를 입력해 주세요.");
}

interface ChannelItem {
  id?: string;
  snippet?: { title?: string; description?: string; customUrl?: string; thumbnails?: { default?: { url?: string }; medium?: { url?: string } } };
  statistics?: { subscriberCount?: string; videoCount?: string; viewCount?: string };
}

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) throw new ApiError(503, "YOUTUBE_NOT_CONFIGURED", "YouTube Data API 키가 아직 연결되지 않았습니다.");
    const query = schema.parse({ q: new URL(request.url).searchParams.get("q") }).q;
    const lookup = channelLookup(query);
    const params = new URLSearchParams({ part: "snippet,statistics", key });
    if ("id" in lookup && lookup.id) params.set("id", lookup.id);
    else if ("forHandle" in lookup && lookup.forHandle) params.set("forHandle", lookup.forHandle);
    const response = await fetch(`https://www.googleapis.com/youtube/v3/channels?${params}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const body = await response.json() as { items?: ChannelItem[]; error?: { message?: string } };
    if (!response.ok) throw new ApiError(502, "YOUTUBE_CHANNEL_FAILED", "YouTube 채널 정보를 불러오지 못했습니다.", body.error?.message);
    const item = body.items?.[0];
    if (!item?.id) throw new ApiError(404, "YOUTUBE_CHANNEL_NOT_FOUND", "해당 채널을 정확히 찾지 못했습니다. 채널 URL을 그대로 붙여 넣어주세요.");
    return NextResponse.json({
      channel: {
        id: item.id,
        title: item.snippet?.title ?? "이름 없는 채널",
        description: item.snippet?.description?.slice(0, 500) ?? "",
        handle: item.snippet?.customUrl ?? "",
        thumbnail: item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? "",
        subscribers: Number(item.statistics?.subscriberCount ?? 0),
        videos: Number(item.statistics?.videoCount ?? 0),
        views: Number(item.statistics?.viewCount ?? 0),
        url: `https://www.youtube.com/channel/${item.id}`,
      },
    });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_YOUTUBE_CHANNEL", "채널 주소를 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
