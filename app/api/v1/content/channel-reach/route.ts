import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { safeSecretMatch } from "@/lib/server/auth";
import { readContentAutomationSettings } from "@/lib/server/content-automation-settings";
import { syncChannelReach } from "@/lib/server/youtube-channel-reach";

// 노출 · 클릭률 (2026-11-13): once a day, after the Analytics run, the YouTube Reporting Reach reports of each connected channel (read only).
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
    return NextResponse.json({ enabled: true, ...await syncChannelReach(new Date()) });
  } catch (error) { return apiErrorResponse(error); }
}
