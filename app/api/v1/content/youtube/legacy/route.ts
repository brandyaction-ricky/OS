import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { adoptLegacyTopic, listLegacyTopics } from "@/lib/server/youtube-process-adopt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };

/** Videos still open on the earlier screens, shown in the project list. */
export async function GET(request: Request) {
  try {
    const actor = await youtubeActor(request);
    return NextResponse.json({ topics: await listLegacyTopics(actor) }, { headers });
  } catch (error) { return apiErrorResponse(error); }
}

/** [새 화면으로 옮기기]: one earlier-flow video becomes a project on the step it had reached. */
export async function POST(request: Request) {
  try {
    const actor = await youtubeActor(request);
    const { id } = z.object({ id: z.string().uuid() }).strict().parse(await parseJson(request, 1_000));
    return NextResponse.json({ project: await adoptLegacyTopic(actor, id) }, { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_ADOPT", "옮길 영상을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
