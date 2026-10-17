import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { readRenderPcStatus } from "@/lib/server/youtube-render-pc";
import { canUseYoutubeAutomationPilot } from "@/lib/youtube-automation-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Render PC on/off, last signal, current job, disk and queue for the 영상 제작 screen. */
export async function GET(request: Request) {
  try {
    if (!canUseYoutubeAutomationPilot(process.env)) throw new ApiError(404, "AUTOMATION_PILOT_DISABLED", "영상 자동화 파일럿이 아직 연결되지 않았습니다.");
    await authenticateRequest(request, { allowAgent: false });
    return NextResponse.json(await readRenderPcStatus(), { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
