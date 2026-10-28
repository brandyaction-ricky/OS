import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { copyYoutubeProject } from "@/lib/server/youtube-process-copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 영상 복제 (owner decision 2026-10-28): a new project from this one, on the same step (제작 at most). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const id = z.string().uuid().parse((await params).id);
    return NextResponse.json({ project: await copyYoutubeProject(actor, id) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_PROJECT_ID", "영상을 다시 골라 주세요."));
    return apiErrorResponse(error);
  }
}
