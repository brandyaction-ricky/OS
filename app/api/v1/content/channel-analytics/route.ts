import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { safeSecretMatch } from "@/lib/server/auth";
import { readContentAutomationSettings } from "@/lib/server/content-automation-settings";
import { syncChannelAnalytics } from "@/lib/server/youtube-channel-analytics";

// 영상 성과 채우기 (2026-11-11): once a day, every video of each connected channel from YouTube Analytics (read only).
// It follows the company's 자동 수집 setting like the hourly channel sync, without that sync's separate switch for comments and reminders.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request) {
  try {
    const expected = process.env.CRON_SECRET ?? "", received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!expected || !safeSecretMatch(received, expected)) throw new ApiError(401, "INVALID_CRON_SECRET", "예약 작업 인증에 실패했습니다.");
    if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") return NextResponse.json({ enabled: false });
    const { settings } = await readContentAutomationSettings();
    if (!settings.autoCollect || !settings.enabledChannels.includes("youtube")) return NextResponse.json({ enabled: true, skipped: "자동 수집이 꺼져 있습니다." });
    return NextResponse.json({ enabled: true, ...await syncChannelAnalytics(new Date()) });
  } catch (error) { return apiErrorResponse(error); }
}
