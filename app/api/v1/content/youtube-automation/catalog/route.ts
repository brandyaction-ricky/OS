import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { safeSecretMatch } from "@/lib/server/auth";
import { saveDiagramCatalog } from "@/lib/server/diagram-catalog";
import { canUseYoutubeAutomationPilot } from "@/lib/youtube-automation-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The render PC reports the diagrams its installed engine can draw (own route: the list is larger than a media action). */
export async function POST(request: Request) {
  try {
    if (!canUseYoutubeAutomationPilot(process.env)) throw new ApiError(404, "AUTOMATION_PILOT_DISABLED", "영상 자동화 파일럿이 아직 연결되지 않았습니다.");
    const expected = process.env.YOUTUBE_MEDIA_WORKER_SECRET ?? "";
    const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (expected.length < 32 || !safeSecretMatch(received, expected)) throw new ApiError(401, "INVALID_WORKER_SECRET", "미디어 워커 인증에 실패했습니다.");
    return NextResponse.json(await saveDiagramCatalog(await parseJson(request, 600_000)), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_DIAGRAM_CATALOG", "도식 목록 형식을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
