import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { cardCreateSchema, createCardProject } from "@/lib/server/youtube-process-cards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A new 카드뉴스: from a topic (주제 찾기 › 카드뉴스), a finished longform · 숏폼, or an approved Threads post. */
export async function POST(request: Request) {
  try {
    const actor = await youtubeActor(request);
    const input = cardCreateSchema.parse(await parseJson(request, 10_000));
    return NextResponse.json({ project: await createCardProject(actor, input) }, { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_CARD", "입력 내용을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
