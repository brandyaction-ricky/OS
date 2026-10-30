import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { saveYoutubeStage, stageSaveSchema } from "@/lib/server/youtube-process-stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Saves one step (기획안 · 구성안 · 제작 · 업로드 · SEO 칼럼 · 숏폼 대본 · 카드뉴스) with the lock rules of 지시서 4-1 · 8-1. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const { id, kind } = await params;
    const input = stageSaveSchema.parse(await parseJson(request, 200_000));
    return NextResponse.json(await saveYoutubeStage(actor, z.string().uuid().parse(id), z.enum(["plan", "outline", "make", "upload", "column", "shortScript", "cards"]).parse(kind), input), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_STAGE", "입력 내용을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
