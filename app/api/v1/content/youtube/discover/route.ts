import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { discoverSchema, discoverYoutube } from "@/lib/server/youtube-discover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 주제 찾기: reference videos for a category (A–L, or all) or a keyword, cached for 12 hours. */
export async function GET(request: Request) {
  try {
    const actor = await youtubeActor(request);
    const query = new URL(request.url).searchParams;
    const input = discoverSchema.parse({ category: query.get("category") ?? undefined, q: query.get("q") ?? undefined, days: query.get("days") ?? undefined, refresh: query.get("refresh") === "1" });
    return NextResponse.json(await discoverYoutube(actor, input), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "DISCOVER_INPUT_INVALID", "분류를 고르거나 검색어를 두 글자 이상 써 주세요."));
    return apiErrorResponse(error);
  }
}
