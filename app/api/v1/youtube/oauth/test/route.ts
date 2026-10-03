import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { authorizeYoutubeConnection, getYoutubeAccessToken } from "@/lib/server/youtube-oauth";
import { auditChannelAction } from "@/lib/server/channel-access";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = z.object({ ownerId: z.string().uuid().optional() }).parse(await parseJson(request));
    const ownerId = input.ownerId ?? actor.id;
    const connection = await authorizeYoutubeConnection(actor, ownerId);
    const token = await getYoutubeAccessToken(ownerId);
    const response = await fetch("https://www.googleapis.com/youtube/v3/channels?part=id&mine=true", { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.items?.some((item: { id: string }) => item.id === connection.channel_id)) throw new ApiError(502, "YOUTUBE_CONNECTION_TEST_FAILED", "연결된 YouTube 채널을 확인하지 못했습니다. 다시 연결해 주세요.");
    await auditChannelAction(actor.id, ownerId, "youtube", "연결 테스트 성공");
    return NextResponse.json({ ok: true, checkedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_CHANNEL_OWNER", "연결 계정을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
