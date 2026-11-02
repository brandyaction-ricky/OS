import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { isDesignatedApprover } from "@/lib/server/document-proposals";
import { approverIds, youtubeV1Allowed } from "@/lib/server/youtube-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    if (!(await youtubeV1Allowed(actor))) throw new ApiError(404, "YOUTUBE_V1_DISABLED", "유튜브 공정 화면을 사용할 수 없습니다.");
    // D1: confirming belongs to the company approver (설정 › 회사 › 승인자), with no admin fallback. approvers: who a PD can ask.
    return NextResponse.json({ canConfirm: await isDesignatedApprover(actor.ownerId), approvers: await approverIds() }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
