import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { getYoutubeProject, youtubeActor } from "@/lib/server/youtube-process";
import { reviewScript } from "@/lib/server/youtube-script-review2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

/** [다시 검수]: GPT judges the 구성안's 원고 now (원고 검수 정본 관문 2~6) and returns the saved judgement. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const project = await getYoutubeProject(actor, z.string().uuid().parse((await params).id));
    const { tier } = z.object({ tier: z.enum(["precise", "saving"]).default("precise") }).parse(await parseJson(request));
    if (!["outline", "make", "review"].includes(project.yp.stage)) throw new ApiError(409, "STAGE_LOCKED", "구성안이 열려 있을 때만 검수할 수 있어요.");
    return NextResponse.json(await reviewScript({ supabase: actor.supabase, id: actor.id, team: actor.team }, project, tier, 700_000), { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
