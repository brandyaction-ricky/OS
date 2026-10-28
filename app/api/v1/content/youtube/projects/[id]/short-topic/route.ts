import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { makeShortFromTopic, makeShortSchema } from "@/lib/server/youtube-process-short-script";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** [숏폼으로 만들기] on a longform's 숏폼 주제 후보 (입구 A, 2026-10-28): a new 숏폼 at 주제, linked back to the longform. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const input = makeShortSchema.parse(await parseJson(request, 2_000));
    return NextResponse.json(await makeShortFromTopic(actor, z.string().uuid().parse((await params).id), input), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_SHORT_TOPIC", "주제 후보를 다시 골라 주세요."));
    return apiErrorResponse(error);
  }
}
