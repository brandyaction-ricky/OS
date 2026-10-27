import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { discoverSchema, discoverYoutube, referenceTitle } from "@/lib/server/youtube-discover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 주제 찾기: reference videos for a category (A–L, or all) or a keyword, cached for 12 hours; ?video= gives one reference's title. */
export async function GET(request: Request) {
  try {
    const actor = await youtubeActor(request);
    const query = new URL(request.url).searchParams;
    const video = query.get("video");
    if (video !== null) {
      if (!/^[\w-]{11}$/.test(video)) throw new ApiError(400, "DISCOVER_INPUT_INVALID", "유튜브 영상 주소를 확인해 주세요.");
      return NextResponse.json(await referenceTitle(video), { headers: { "cache-control": "private, no-store" } });
    }
    const input = discoverSchema.parse({ category: query.get("category") ?? undefined, q: query.get("q") ?? undefined, days: query.get("days") ?? undefined, refresh: query.get("refresh") === "1" });
    return NextResponse.json(await discoverYoutube(actor, input), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "DISCOVER_INPUT_INVALID", "분류를 고르거나 검색어를 두 글자 이상 써 주세요."));
    return apiErrorResponse(error);
  }
}
