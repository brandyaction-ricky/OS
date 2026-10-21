import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { datesSchema, moveYoutubeDates } from "@/lib/server/youtube-process-stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 스케줄: 편집 완료 · 업로드 (예상) moved on the calendar. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const input = datesSchema.parse(await parseJson(request, 2_000));
    return NextResponse.json({ stage: await moveYoutubeDates(actor, z.string().uuid().parse((await params).id), input) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_DATES", "날짜를 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
