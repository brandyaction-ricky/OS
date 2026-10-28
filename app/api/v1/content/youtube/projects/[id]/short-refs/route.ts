import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { readShortRefs, requestShortRefs } from "@/lib/server/youtube-process-short-refs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
const id = async (params: Promise<{ id: string }>) => z.string().uuid().parse((await params).id);

/** The 대본 step's latest 레퍼런스 받기: what the render PC kept of each reference (thumbnail, first three seconds, words). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json({ refs: await readShortRefs(await youtubeActor(request), await id(params)) }, { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_PROJECT", "영상을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}

/** [레퍼런스 받기]: the Shorts found for the 검색어 plus the PD's links go to the render PC. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json({ refs: await requestShortRefs(await youtubeActor(request), await id(params)) }, { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_PROJECT", "영상을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
