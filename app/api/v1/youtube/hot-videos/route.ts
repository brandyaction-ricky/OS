import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { collectHotVideoBoards } from "@/lib/server/hot-video-board";
import { HOT_VIDEO_REGIONS } from "@/lib/hot-video-board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const url = new URL(request.url);
    const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
    const region = url.searchParams.get("region") ?? "KR";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, "INVALID_DATE", "기준일 형식이 올바르지 않습니다.");
    if (!HOT_VIDEO_REGIONS.includes(region as (typeof HOT_VIDEO_REGIONS)[number])) throw new ApiError(400, "INVALID_REGION", "지원하지 않는 지역입니다.");
    const { data, error } = await actor.supabase.from("os_records").select("id,metadata,updated_at").eq("record_type", "content_package").eq("metadata->>packageKind", "hot_video_board").eq("metadata->>date", date).eq("metadata->>region", region).is("archived_at", null).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ board: data ?? null, date, region });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 핫 비디오를 다시 수집할 수 있습니다.");
    return NextResponse.json(await collectHotVideoBoards());
  } catch (error) { return apiErrorResponse(error); }
}
