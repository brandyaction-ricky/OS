import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { safeSecretMatch } from "@/lib/server/auth";
import { remindConfirmations, remindReviewers } from "@/lib/server/youtube-process";
import { remindStudioPins } from "@/lib/server/youtube-studio";
import { youtubeV1Enabled } from "@/lib/youtube-process/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Hourly at :45 (vercel.json): 6-hour confirm reminders, the day's 검토 담당 reminders and pins that became possible (스튜디오 작업), quiet 22:00–08:00 KST. Does nothing while the switch is off. */
export async function GET(request: Request) {
  try {
    const expected = process.env.CRON_SECRET ?? "";
    const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!expected || !safeSecretMatch(received, expected)) throw new ApiError(401, "INVALID_CRON_SECRET", "예약 작업 인증에 실패했습니다.");
    if (!youtubeV1Enabled()) return NextResponse.json({ skipped: "YOUTUBE_V1_DISABLED" });
    return NextResponse.json({ ...await remindConfirmations(), ...await remindReviewers(), ...await remindStudioPins() });
  } catch (error) { return apiErrorResponse(error); }
}
