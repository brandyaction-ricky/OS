import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { readOpenAiCredit } from "@/lib/server/openai-credit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "GPT 크레딧은 관리자만 볼 수 있어요.");
    return NextResponse.json(await readOpenAiCredit(), { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
