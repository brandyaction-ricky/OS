import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { decideNiche, nicheDecisionSchema, readNicheBoard } from "@/lib/server/youtube-niche";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };

/** 주제 찾기 › 틈새: the latest grouping, the decisions, and how many 터진 영상 the next grouping would read. */
export async function GET(request: Request) {
  try { return NextResponse.json(await readNicheBoard(await youtubeActor(request)), { headers }); } catch (error) { return apiErrorResponse(error); }
}

/** [기획으로 넘기기] · [더 지켜보기] · [안 하기] on one niche (decision null undoes it). */
export async function POST(request: Request) {
  try {
    const actor = await youtubeActor(request);
    return NextResponse.json(await decideNiche(actor, nicheDecisionSchema.parse(await parseJson(request, 4_000))), { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "NICHE_DECISION_INVALID", "틈새와 결정을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
