import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { openYoutubeRenderedVideo } from "@/lib/server/youtube-render-run";
import { canUseYoutubeAutomationPilot } from "@/lib/youtube-automation-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Team members who can read the content open its rendered video through a short-lived private URL. */
export async function GET(request: Request) {
  try {
    if (!canUseYoutubeAutomationPilot(process.env)) throw new ApiError(404, "AUTOMATION_PILOT_DISABLED", "영상 자동화 파일럿이 아직 연결되지 않았습니다.");
    const actor = await authenticateRequest(request, { allowAgent: false });
    const sourceId = new URL(request.url).searchParams.get("sourceId") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(sourceId)) throw new ApiError(400, "INVALID_SOURCE_ID", "콘텐츠를 확인해 주세요.");
    return NextResponse.json(await openYoutubeRenderedVideo(actor.supabase, sourceId), { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
