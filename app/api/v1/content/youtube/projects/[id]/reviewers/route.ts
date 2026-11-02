import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { reviewersSchema, setYoutubeReviewers } from "@/lib/server/youtube-process-stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 최종 검토: who checks which part by when, and a reviewer's own 검토 끝 (유쓰 요청 8/8). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const input = reviewersSchema.parse(await parseJson(request, 4_000));
    return NextResponse.json({ stage: await setYoutubeReviewers(actor, z.string().uuid().parse((await params).id), input) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_REVIEWERS", "검토 담당 · 맡은 부분 · 날짜를 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
