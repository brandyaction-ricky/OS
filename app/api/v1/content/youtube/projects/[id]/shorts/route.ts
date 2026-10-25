import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { actOnShorts, shortsActionSchema } from "@/lib/server/youtube-process-stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 쇼츠 확정 by the PD, or a comment on the 확정 record (the 대표 from 대표 메뉴 › 컨펌, or the PD). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const input = shortsActionSchema.parse(await parseJson(request, 4_000));
    return NextResponse.json({ project: await actOnShorts(actor, z.string().uuid().parse((await params).id), input) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_SHORTS_ACTION", "확정 · 코멘트 내용을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
