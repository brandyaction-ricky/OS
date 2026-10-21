import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { youtubeSchedule } from "@/lib/server/youtube-process-stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** S9 스케줄: every project's 편집 완료 · 업로드 (예상) · 컨펌 대기. */
export async function GET(request: Request) {
  try {
    const actor = await youtubeActor(request);
    return NextResponse.json({ items: await youtubeSchedule(actor) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
