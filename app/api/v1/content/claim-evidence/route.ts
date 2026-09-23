import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { claimEvidenceInput } from "@/lib/content-claim-evidence";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { canUseSystemOneJevShadow } from "@/lib/system-one-jev-shadow-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store", vary: "Authorization" };

export async function POST(request: Request) {
  if (!canUseSystemOneJevShadow(process.env)) return NextResponse.json({ error: { message: "DEV 시험 환경에서만 사용할 수 있습니다." } }, { status: 404, headers });
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token || token.startsWith("bos_pat_")) return NextResponse.json({ error: { message: "사용자 로그인 상태를 확인해 주세요." } }, { status: 401, headers });
  try {
    const input = claimEvidenceInput.parse(await parseJson(request, 12_000));
    const actor = await authenticateRequest(request, { allowAgent: false, allowPasswordChangeRequired: false });
    if (actor.type !== "user" || actor.user?.id !== actor.id || actor.mustChangePassword)
      throw new ApiError(401, "AUTHENTICATION_REQUIRED", "사용자 로그인 상태를 확인해 주세요.");
    const { data: source, error: sourceError } = await actor.supabase.from("os_records")
      .select("id,record_type,brand,team,owner_id,version,archived_at")
      .eq("id", input.sourceId).eq("record_type", "content_topic").eq("owner_id", actor.id).is("archived_at", null)
      .maybeSingle();
    if (sourceError) throw new ApiError(503, "SOURCE_READ_FAILED", "기획 주제를 읽지 못했습니다.");
    if (!source || source.brand !== "브랜디액션") throw new ApiError(404, "SOURCE_NOT_FOUND", "이 주제에 접근할 수 없습니다.");
    if (source.version !== input.expectedSourceVersion) throw new ApiError(409, "SOURCE_CHANGED", "주제가 변경됐습니다. 최신 자료를 다시 읽어 주세요.");
    const fields = {
      location: input.location, locationDetail: input.locationDetail, claimText: input.claimText,
      sourceRelation: input.sourceRelation, sourceUrl: input.sourceUrl, sourceIdentifier: input.sourceIdentifier,
      sourceExcerpt: input.sourceExcerpt, measuredConcept: input.measuredConcept, population: input.population,
      sample: input.sample, comparison: input.comparison, conditions: input.conditions,
      assessment: input.assessment, rationale: input.rationale,
    };
    const { data: record, error } = await actor.supabase.from("os_records").insert({
      record_type: "content_package", parent_id: source.id, title: `주장 근거 · ${input.location} · ${input.claimText.slice(0, 160)}`,
      description: "검토자가 입력한 주장·근거 카드. 독립 사실 검증 또는 발행 승인 아님.",
      status: "draft", priority: "normal", stage: "evidence", brand: source.brand, team: source.team || actor.team,
      owner_id: actor.id, created_by: actor.id, updated_by: actor.id, source_url: input.sourceUrl || null,
      metadata: { packageKind: "claim_evidence", schemaVersion: 1, verification: "reviewer_entered", ...fields },
    }).select("*").single();
    if (error || !record) throw new ApiError(503, "EVIDENCE_SAVE_FAILED", "주장 근거를 저장하지 못했습니다.");
    return NextResponse.json({ record }, { status: 201, headers });
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: { message: "주장·출처·검토 사유의 필수 항목을 확인해 주세요." } }, { status: 400, headers });
    const response = apiErrorResponse(error);
    response.headers.set("cache-control", headers["cache-control"]);
    response.headers.set("vary", headers.vary);
    return response;
  }
}
