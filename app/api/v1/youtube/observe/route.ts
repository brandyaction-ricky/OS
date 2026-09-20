import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest, safeSecretMatch } from "@/lib/server/auth";
import { observeYoutubeChannels } from "@/lib/server/youtube-observation";
import { collectHotVideoBoards } from "@/lib/server/hot-video-board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function observationResponse() {
  const [counts, hotVideos] = await Promise.all([
    observeYoutubeChannels(),
    collectHotVideoBoards().catch((error) => ({ date: new Date().toISOString().slice(0, 10), regions: 0, videos: 0, failures: [{ region: "all", reason: error instanceof Error ? error.message : "핫 비디오 수집에 실패했습니다." }], quota: null })),
  ]);
  console.info(JSON.stringify({ event: "youtube_observation_completed", ...counts, hotVideos }));
  return NextResponse.json({ ok: counts.failures === 0 && hotVideos.failures.length === 0, ...counts, hotVideos }, { status: counts.failures === counts.channels && counts.failures > 0 ? 502 : 200 });
}

export async function GET(request: Request) {
  try {
    const expected = process.env.CRON_SECRET ?? "";
    const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!expected || !safeSecretMatch(received, expected)) throw new ApiError(401, "INVALID_CRON_SECRET", "예약 작업 인증에 실패했습니다.");
    return await observationResponse();
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 관찰 채널 수집을 실행할 수 있습니다.");
    return await observationResponse();
  } catch (error) { return apiErrorResponse(error); }
}
