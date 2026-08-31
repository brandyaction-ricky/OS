import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { apiErrorResponse, ApiError, parseJson } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { searchSchema } from "@/lib/validation";
import { authenticateRequest } from "@/lib/server/auth";
import { searchDocuments } from "@/lib/server/search";
import { assertOrganization } from "@/lib/server/organization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const actor = await authenticateRequest(request, { allowAgent: true });
    const input = searchSchema.parse(await parseJson(request, 64_000));
    if (actor.type === "agent" && !input.organizationId) {
      throw new ApiError(400, "ORGANIZATION_REQUIRED", "에이전트 검색에는 organizationId가 필요합니다.");
    }
    if (input.organizationId) await assertOrganization(actor, input.organizationId);
    if (input.mode === "semantic" && !process.env.OPENAI_API_KEY) {
      throw new ApiError(503, "SEMANTIC_SEARCH_UNAVAILABLE", "의미 검색 환경변수가 아직 연결되지 않았습니다.");
    }
    const outcome = await searchDocuments(actor, input);
    const tookMs = Date.now() - started;
    try {
      if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
        await createServiceSupabase().from("os_search_logs").insert({
          actor_type: actor.type,
          actor_id: actor.id,
          query_length: input.query.length,
          mode: input.mode,
          result_count: outcome.results.length,
          took_ms: tookMs,
          degraded: outcome.degraded,
        });
      }
    } catch { /* Telemetry must not fail the search. */ }
    return NextResponse.json({ query: input.query, mode: input.mode, degraded: outcome.degraded, results: outcome.results, tookMs });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_SEARCH", "검색 조건을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
