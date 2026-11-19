import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { makeRecycleSchema, makeShortFromRecycle } from "@/lib/server/youtube-process-short-recycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** [숏폼으로 만들기] on a longform's 롱폼에서 뽑기 stretch (「롱폼 재활용 숏폼 정본」): a new 숏폼 at 제작 with the longform's voice, cut. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const input = makeRecycleSchema.parse(await parseJson(request, 2_000));
    return NextResponse.json(await makeShortFromRecycle(actor, z.string().uuid().parse((await params).id), input), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_RECYCLE_ITEM", "구간을 다시 골라 주세요."));
    return apiErrorResponse(error);
  }
}
