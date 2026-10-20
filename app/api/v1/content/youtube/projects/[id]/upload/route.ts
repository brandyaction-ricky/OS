import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { completeYoutubeUpload, startYoutubeUpload, uploadCompleteSchema, uploadSessionSchema } from "@/lib/server/youtube-process-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const actionSchema = z.object({ action: z.enum(["session", "complete"]) }).passthrough();

/** S7 [업로드]: open YouTube's upload session, then record the uploaded video. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const id = z.string().uuid().parse((await params).id);
    const { action, ...rest } = actionSchema.parse(await parseJson(request, 8_000));
    const result = action === "session" ? await startYoutubeUpload(actor, id, uploadSessionSchema.parse(rest)) : await completeYoutubeUpload(actor, id, uploadCompleteSchema.parse(rest));
    return NextResponse.json(result, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_YOUTUBE_UPLOAD", "업로드 내용을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
