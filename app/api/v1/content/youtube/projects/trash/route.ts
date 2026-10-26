import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { listYoutubeTrash } from "@/lib/server/youtube-process-trash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 내 영상 › 휴지통: trashed videos not yet purged, newest first. */
export async function GET(request: Request) {
  try {
    const actor = await youtubeActor(request);
    return NextResponse.json({ items: await listYoutubeTrash(actor) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
