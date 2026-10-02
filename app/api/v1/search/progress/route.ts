import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { getIndexCoverage } from "@/lib/server/indexing-diagnostics";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request: Request) { try {
    const actor = await authenticateRequest(request);
    return NextResponse.json({ coverage: await getIndexCoverage(actor.supabase) }, { headers: { "Cache-Control": "private, no-store" } });
}
catch (error) {
    return apiErrorResponse(error instanceof ApiError ? error : new ApiError(503, "INDEX_PROGRESS_UNAVAILABLE", "검색 준비 현황을 확인하지 못했습니다."));
} }
