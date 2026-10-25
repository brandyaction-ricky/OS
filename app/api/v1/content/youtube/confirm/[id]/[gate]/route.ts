import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { confirmActionSchema, youtubeActor } from "@/lib/server/youtube-process";
import { decideYoutubeGate } from "@/lib/server/youtube-process-stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const gateSchema = z.enum(["topic", "draft", "review", "shorts"]);

/** OK · 수정 요청 · 보류 · 결정 되돌리기 by the company approver (403 NOT_APPROVER for anyone else). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; gate: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const { id, gate } = await params;
    const input = confirmActionSchema.parse(await parseJson(request, 4_000));
    const project = await decideYoutubeGate(actor, z.string().uuid().parse(id), gateSchema.parse(gate), input);
    return NextResponse.json({ project }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_CONFIRM", "컨펌 내용을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
