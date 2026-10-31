import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { applyCta, channelVideos, ctaApplySchema, ctaHistory, ctaUndoSchema, undoCta } from "@/lib/server/youtube-cta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };

/** CTA 일괄 관리: the connected channel's uploads (?videos=1) and the past changes. */
export async function GET(request: Request) {
  try {
    const actor = await youtubeActor(request);
    const url = new URL(request.url);
    const ownerId = z.string().uuid().optional().parse(url.searchParams.get("ownerId") || undefined) ?? actor.id;
    return NextResponse.json({ history: await ctaHistory(), ...(url.searchParams.get("videos") ? { videos: await channelVideos(actor, ownerId) } : {}) }, { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "CTA_INVALID", "채널을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}

/** Change the descriptions of the picked videos, or undo an earlier change. */
export async function POST(request: Request) {
  try {
    const actor = await youtubeActor(request);
    const body = await parseJson(request, 20_000) as { action?: string };
    return NextResponse.json(body.action === "undo" ? await undoCta(actor, ctaUndoSchema.parse(body)) : await applyCta(actor, ctaApplySchema.parse(body)), { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "CTA_INVALID", "찾을 말 · 바꿀 말과 고른 영상을 확인해 주세요 (한 번에 50개까지)."));
    return apiErrorResponse(error);
  }
}
