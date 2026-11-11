import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { renderThumbPick, thumbRenderSchema, youtubeThumbsView } from "@/lib/server/youtube-thumbs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
const projectId = z.string().uuid();

/** 롱폼 애니메이션 썸네일 후보: the AI's candidates with a one-hour link to each picture, and the market videos shown beside them. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json(await youtubeThumbsView(await youtubeActor(request), projectId.parse((await params).id)), { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(404, "YOUTUBE_PROJECT_NOT_FOUND", "프로젝트를 찾지 못했습니다."));
    return apiErrorResponse(error);
  }
}

/** 고르기: the picked picture with the picked copy as the thumbnail PNG (the picker's own frame); the screen then saves its path in the slot. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const input = thumbRenderSchema.parse(await parseJson(request, 4_000));
    return NextResponse.json(await renderThumbPick(actor, projectId.parse((await params).id), input), { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "THUMB_RENDER_INPUT", "고른 후보와 문구를 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
