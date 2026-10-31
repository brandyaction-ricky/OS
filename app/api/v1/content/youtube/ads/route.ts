import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { adHistory } from "@/lib/server/youtube-ad-results";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 지난 광고 성과, best return first (광고 성과 1단계). */
export async function GET(request: Request) {
  try {
    const actor = await youtubeActor(request);
    return NextResponse.json({ rows: await adHistory(actor.supabase) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
