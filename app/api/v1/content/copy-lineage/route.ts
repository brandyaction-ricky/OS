import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { copyLineageInput } from "@/lib/content-copy-lineage";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { canUseSystemOneContentEvidence } from "@/lib/system-one-content-evidence-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store", vary: "Authorization" };

export async function POST(request: Request) {
  if (!canUseSystemOneContentEvidence(process.env)) return NextResponse.json({ error: { message: "DEV 시험 환경에서만 사용할 수 있습니다." } }, { status: 404, headers });
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token || token.startsWith("bos_pat_")) return NextResponse.json({ error: { message: "사용자 로그인 상태를 확인해 주세요." } }, { status: 401, headers });
  try {
    const input = copyLineageInput.parse(await parseJson(request, 8_000));
    const actor = await authenticateRequest(request, { allowAgent: false, allowPasswordChangeRequired: false });
    if (actor.type !== "user" || actor.user?.id !== actor.id || actor.mustChangePassword)
      throw new ApiError(401, "AUTHENTICATION_REQUIRED", "사용자 로그인 상태를 확인해 주세요.");
    const { data: source, error: sourceError } = await actor.supabase.from("os_records")
      .select("id,record_type,brand,team,owner_id,version,archived_at")
      .eq("id", input.sourceId).eq("record_type", "content_topic").is("archived_at", null)
      .maybeSingle();
    if (sourceError) throw new ApiError(503, "SOURCE_READ_FAILED", "기획 주제를 읽지 못했습니다.");
    if (!source || source.brand !== "브랜디액션" || (source.owner_id !== actor.id && (!source.team?.trim() || source.team.trim() !== actor.team.trim())))
      throw new ApiError(404, "SOURCE_NOT_FOUND", "이 주제에 접근할 수 없습니다.");
    if (source.version !== input.expectedSourceVersion) throw new ApiError(409, "SOURCE_CHANGED", "주제가 변경됐습니다. 최신 자료를 다시 읽어 주세요.");

    const metadata = input.kind === "decision" ? {
      packageKind: "copy_decision_evidence", schemaVersion: 1, verification: "user_entered",
      decisionAt: input.decisionAt, evidenceUrl: input.evidenceUrl,
      title: input.title, thumbnailCopy: input.thumbnailCopy, note: input.note,
    } : {
      packageKind: "publication_copy_observation", schemaVersion: 1, verification: "user_entered",
      observedAt: input.observedAt, videoUrl: input.videoUrl,
      title: input.title, thumbnailCopy: input.thumbnailCopy, note: input.note,
    };
    const { data: record, error } = await actor.supabase.from("os_records").insert({
      record_type: "content_package", parent_id: source.id,
      title: input.kind === "decision" ? `카피 결정 근거 · ${input.decisionAt}` : `공개본 카피 관측 · ${input.observedAt}`,
      description: "사용자 입력 증거. 승인·공개본·출처의 독립 검증은 아직 수행하지 않음.",
      status: "draft", priority: "normal", stage: "evidence", brand: source.brand, team: source.team,
      owner_id: actor.id, created_by: actor.id, updated_by: actor.id,
      source_url: input.kind === "decision" ? input.evidenceUrl : input.videoUrl,
      metadata,
    }).select("*").single();
    if (error || !record) throw new ApiError(503, "EVIDENCE_SAVE_FAILED", "증거 기록을 저장하지 못했습니다.");
    return NextResponse.json({ record }, { status: 201, headers });
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: { message: "입력한 날짜·주소·문구를 확인해 주세요." } }, { status: 400, headers });
    const response = apiErrorResponse(error);
    response.headers.set("cache-control", headers["cache-control"]);
    response.headers.set("vary", headers.vary);
    return response;
  }
}
