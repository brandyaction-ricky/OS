import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { projectPatchSchema, updateYoutubeProject, youtubeActor } from "@/lib/server/youtube-process";
import { youtubeProjectBundle } from "@/lib/server/youtube-process-stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
const projectId = z.string().uuid();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    return NextResponse.json(await youtubeProjectBundle(actor, projectId.parse((await params).id)), { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(404, "YOUTUBE_PROJECT_NOT_FOUND", "프로젝트를 찾지 못했습니다."));
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const id = projectId.parse((await params).id);
    const input = projectPatchSchema.parse(await parseJson(request, 20_000));
    return NextResponse.json({ project: await updateYoutubeProject(actor, id, input) }, { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_PROJECT", "입력 내용을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
