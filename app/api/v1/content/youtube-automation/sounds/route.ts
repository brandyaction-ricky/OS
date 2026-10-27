import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { safeSecretMatch } from "@/lib/server/auth";
import { saveSoundCatalog } from "@/lib/server/sound-catalog";
import { canUseYoutubeAutomationPilot } from "@/lib/youtube-automation-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The render PC reports the sounds its installed package can play (사운드 창고, own route like the diagram list). */
export async function POST(request: Request) {
  try {
    if (!canUseYoutubeAutomationPilot(process.env)) throw new ApiError(404, "AUTOMATION_PILOT_DISABLED", "영상 자동화 파일럿이 아직 연결되지 않았습니다.");
    const expected = process.env.YOUTUBE_MEDIA_WORKER_SECRET ?? "";
    const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (expected.length < 32 || !safeSecretMatch(received, expected)) throw new ApiError(401, "INVALID_WORKER_SECRET", "미디어 워커 인증에 실패했습니다.");
    return NextResponse.json(await saveSoundCatalog(await parseJson(request, 200_000)), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_SOUND_CATALOG", "사운드 목록 형식을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
