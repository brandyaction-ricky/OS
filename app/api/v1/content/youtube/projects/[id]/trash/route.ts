import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { actOnYoutubeTrash, trashActionSchema } from "@/lib/server/youtube-process-trash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 휴지통으로 · 복구 · 영구 삭제 (관리자, 30일 뒤) for one video. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const id = z.string().uuid().parse((await params).id);
    const input = trashActionSchema.parse(await parseJson(request, 4_000));
    return NextResponse.json(await actOnYoutubeTrash(actor, id, input), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_TRASH_ACTION", "영구 삭제는 사유와 확인이 필요해요."));
    return apiErrorResponse(error);
  }
}
