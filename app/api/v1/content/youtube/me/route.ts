import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { isDesignatedApprover } from "@/lib/server/document-proposals";
import { youtubeV1Allowed } from "@/lib/server/youtube-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ponytail: only canConfirm for now; me and members[] (담당 PD 목록) arrive with the project API in T3.
export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    if (!(await youtubeV1Allowed(actor))) throw new ApiError(404, "YOUTUBE_V1_DISABLED", "유튜브 공정 화면을 사용할 수 없습니다.");
    // D1: confirming belongs to the company approver (설정 › 회사 › 승인자), with no admin fallback.
    return NextResponse.json({ canConfirm: await isDesignatedApprover(actor.ownerId) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
