import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { gateActionSchema, youtubeActor } from "@/lib/server/youtube-process";
import { requestYoutubeGate } from "@/lib/server/youtube-process-stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; gate: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const { id, gate } = await params;
    const input = gateActionSchema.parse(await parseJson(request, 2_000));
    return NextResponse.json(await requestYoutubeGate(actor, z.string().uuid().parse(id), z.enum(["topic", "draft", "review"]).parse(gate), input), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_GATE_ACTION", "요청 내용을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
