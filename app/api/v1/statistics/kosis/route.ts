import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { KosisError, kosisInputSchema, queryKosis } from "@/lib/kosis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await authenticateRequest(request, { allowAgent: true, requiredAgentScope: "knowledge.read" });
    const input = kosisInputSchema.parse(await parseJson(request, 8_000));
    return NextResponse.json(await queryKosis(input, process.env.KOSIS_API_KEY), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_KOSIS_QUERY", "통계 조회 조건을 확인해 주세요."));
    if (error instanceof KosisError) return apiErrorResponse(new ApiError(error.status, error.code, error.message));
    return apiErrorResponse(error);
  }
}
