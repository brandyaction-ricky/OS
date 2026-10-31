import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { actOnGrind, grindActionSchema, grindKindSchema, readGrind } from "@/lib/server/canon-grind";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 다시 뽑기 runs GPT after its response (next/server after) for several minutes.
export const maxDuration = 800;
const headers = { "cache-control": "private, no-store" };
const kindOf = (request: Request) => grindKindSchema.parse(new URL(request.url).searchParams.get("kind") ?? "card");

/** 정본 다듬기 (?kind=card | short | threads | column): the 시험 묶음, the runs under each 정본 version and their scores. */
export async function GET(request: Request) {
  try {
    const actor = await youtubeActor(request);
    return NextResponse.json({ ...(await readGrind(kindOf(request))), me: actor.ownerId }, { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_GRIND", "요청을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}

/** 시험 원본 넣기 · 빼기, 이 정본으로 다시 뽑기 (company GPT), 평가표 채점. */
export async function POST(request: Request) {
  try {
    const actor = await youtubeActor(request);
    const input = grindActionSchema.parse(await parseJson(request, 20_000));
    return NextResponse.json({ ...(await actOnGrind(actor, kindOf(request), input)), me: actor.ownerId }, { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_GRIND", "입력 내용을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
