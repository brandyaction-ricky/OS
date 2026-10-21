import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { moveYoutubeStage, stageMoveSchema } from "@/lib/server/youtube-process-stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 다음: 제작 · 다음: 최종 검수 · 여기서 끝내기. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const input = stageMoveSchema.parse(await parseJson(request, 2_000));
    return NextResponse.json({ project: await moveYoutubeStage(actor, z.string().uuid().parse((await params).id), input) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_STAGE_MOVE", "요청 내용을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
