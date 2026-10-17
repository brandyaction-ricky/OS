import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { actOnTopicGate, gateActionSchema, youtubeActor } from "@/lib/server/youtube-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ponytail: only the topic gate exists until T5 (기획안) and T8 (최종 검수) add theirs.
export async function POST(request: Request, { params }: { params: Promise<{ id: string; gate: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const { id, gate } = await params;
    if (gate !== "topic") throw new ApiError(404, "GATE_NOT_READY", "아직 열리지 않은 컨펌 단계예요.");
    const input = gateActionSchema.parse(await parseJson(request, 2_000));
    return NextResponse.json(await actOnTopicGate(actor, z.string().uuid().parse(id), input), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_GATE_ACTION", "요청 내용을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
