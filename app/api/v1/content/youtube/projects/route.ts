import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { createYoutubeProject, listYoutubeProjects, projectCreateSchema, youtubeActor } from "@/lib/server/youtube-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const actor = await youtubeActor(request);
    return NextResponse.json({ projects: await listYoutubeProjects(actor) }, { headers });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await youtubeActor(request);
    const input = projectCreateSchema.parse(await parseJson(request, 20_000));
    return NextResponse.json({ project: await createYoutubeProject(actor, input) }, { status: 201, headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_PROJECT", "입력 내용을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
