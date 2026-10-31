import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { adResultSchema, saveAdResult } from "@/lib/server/youtube-ad-results";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 광고 성과 1단계: add, change or remove one period's numbers of this ad. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const id = z.string().uuid().parse((await params).id);
    return NextResponse.json(await saveAdResult(actor, id, adResultSchema.parse(await parseJson(request, 8_000))), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "AD_RESULT_INVALID", "광고 성과 숫자와 기간을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
