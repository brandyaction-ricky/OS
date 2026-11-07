import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { channelStylesSchema, readChannelStyles, saveChannelStyles } from "@/lib/server/youtube-channel-styles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };

/** 채널 카드 (채널 모양, 2026-11-02): a project picks its channel; the look is pinned when a video's voice starts. Kept on 채널/링크 관리 › 채널. */
export async function GET(request: Request) {
  try {
    await youtubeActor(request);
    return NextResponse.json(await readChannelStyles(), { headers });
  } catch (error) { return apiErrorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    const actor = await youtubeActor(request);
    return NextResponse.json(await saveChannelStyles(actor, channelStylesSchema.parse(await parseJson(request, 40_000))), { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "CHANNEL_STYLES_INVALID", "채널을 확인해 주세요. 이름은 30자, 색은 #RRGGBB, 운영 형식은 하나 이상이에요."));
    return apiErrorResponse(error);
  }
}
