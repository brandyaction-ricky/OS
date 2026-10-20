import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { assetCreateSchema, createYoutubeAssetUpload, youtubeAssetUrl } from "@/lib/server/youtube-process-stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
const projectId = z.string().uuid();

/** A signed upload address for a 시안 image, final thumbnail, final video or SRT of this project. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const input = assetCreateSchema.parse(await parseJson(request, 4_000));
    return NextResponse.json(await createYoutubeAssetUpload(actor, projectId.parse((await params).id), input), { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_ASSET", "파일 정보를 확인해 주세요."));
    return apiErrorResponse(error);
  }
}

/** A one-hour link to one of the project's files. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const path = new URL(request.url).searchParams.get("path") ?? "";
    return NextResponse.json({ url: await youtubeAssetUrl(actor, projectId.parse((await params).id), path) }, { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(404, "YOUTUBE_PROJECT_NOT_FOUND", "프로젝트를 찾지 못했습니다."));
    return apiErrorResponse(error);
  }
}
