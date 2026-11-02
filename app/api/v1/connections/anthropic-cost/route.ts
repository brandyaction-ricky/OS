import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { readAnthropicCost } from "@/lib/server/anthropic-cost";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "Claude 사용 금액은 관리자만 볼 수 있어요.");
    return NextResponse.json(await readAnthropicCost(), { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
