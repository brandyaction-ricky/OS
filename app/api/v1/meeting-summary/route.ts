import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { summarizeMeetingText } from "@/lib/server/meeting-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await authenticateRequest(request);
    const body = await parseJson(request) as { transcript?: unknown; meetingDate?: unknown; business?: unknown };
    const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
    if (transcript.length < 20 || transcript.length > 200_000) throw new ApiError(400, "INVALID_TRANSCRIPT", "회의 원문은 20자 이상 20만자 이하로 입력해 주세요.");
    const meetingDate = typeof body.meetingDate === "string" ? body.meetingDate : undefined;
    return NextResponse.json(await summarizeMeetingText(transcript, meetingDate));
  } catch (error) { return apiErrorResponse(error); }
}
