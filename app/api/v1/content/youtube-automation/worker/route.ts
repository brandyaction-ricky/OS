import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { safeSecretMatch } from "@/lib/server/auth";
import { processYoutubeVoiceQueue } from "@/lib/server/youtube-voice-worker";
import { canUseYoutubeAutomationPilot } from "@/lib/youtube-automation-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** A DEV/QA-only scheduler, or the media worker, calls one bounded voice step per request. */
export async function POST(request: Request) {
  try {
    if (!canUseYoutubeAutomationPilot(process.env)) throw new ApiError(404, "AUTOMATION_PILOT_DISABLED", "영상 자동화 파일럿이 아직 연결되지 않았습니다.");
    const cron = process.env.CRON_SECRET ?? "";
    const media = process.env.YOUTUBE_MEDIA_WORKER_SECRET ?? "";
    const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!(cron && safeSecretMatch(received, cron)) && !(media.length >= 32 && safeSecretMatch(received, media)))
      throw new ApiError(401, "INVALID_CRON_SECRET", "작업 실행 인증에 실패했습니다.");
    return NextResponse.json(await processYoutubeVoiceQueue(), { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
