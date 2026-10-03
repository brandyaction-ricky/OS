import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_approver"), userId: z.string().uuid() }),
  z.object({ action: z.literal("delegate"), userId: z.string().uuid(), startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ action: z.literal("revoke"), assignmentId: z.string().uuid() }),
]);

function activeToday(row: { starts_on: string | null; ends_on: string | null; revoked_at: string | null }, today: string) {
  return !row.revoked_at && (!row.starts_on || row.starts_on <= today) && (!row.ends_on || row.ends_on >= today);
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    if (actor.type !== "user") throw new ApiError(403, "USER_REQUIRED", "구성원 계정으로 확인해 주세요.");
    const service = createServiceSupabase();
    const { data, error } = await service.from("os_approval_assignments")
      .select("id,user_id,kind,delegated_by,starts_on,ends_on,created_at,revoked_at")
      .is("revoked_at", null).order("created_at", { ascending: false });
    if (error) throw new ApiError(503, "APPROVAL_SETUP_PENDING", "승인 설정을 아직 불러올 수 없습니다.");
    const search = new URL(request.url).searchParams;
    const documentId = search.get("documentId");
    const recordId = search.get("recordId");
    if (documentId && recordId) throw new ApiError(400, "APPROVAL_TARGET_AMBIGUOUS", "확인할 대상 하나만 지정해 주세요.");
    let canApprove: boolean | null = null;
    if (documentId) {
      const { data: document, error: documentError } = await actor.supabase.from("os_documents")
        .select("id,owner_id").eq("id", documentId).maybeSingle();
      if (documentError || !document) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "문서를 찾을 수 없습니다.");
      const result = await actor.supabase.rpc("os_can_approve", { p_actor: actor.id, p_author: document.owner_id });
      if (result.error) throw new ApiError(503, "APPROVAL_SETUP_PENDING", "승인 규칙을 아직 확인할 수 없습니다.");
      canApprove = result.data === true;
    }
    if (recordId) {
      const { data: record, error: recordError } = await actor.supabase.from("os_records")
        .select("id,record_type,created_by,metadata").eq("id", recordId).is("archived_at", null).maybeSingle();
      if (recordError || !record || record.record_type !== "content_package" || record.metadata?.packageKind !== "appeal_candidates") {
        throw new ApiError(404, "APPEAL_NOT_FOUND", "소구점 후보를 찾을 수 없습니다.");
      }
      const result = await actor.supabase.rpc("os_can_approve", { p_actor: actor.id, p_author: record.created_by });
      if (result.error) throw new ApiError(503, "APPROVAL_SETUP_PENDING", "승인 규칙을 아직 확인할 수 없습니다.");
      canApprove = result.data === true;
    }
    return NextResponse.json({ assignments: data ?? [], canApprove }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    if (actor.type !== "user") throw new ApiError(403, "USER_REQUIRED", "구성원 계정으로 승인자를 관리해 주세요.");
    const input = updateSchema.parse(await parseJson(request, 16_000));
    const service = createServiceSupabase();
    const today = new Date().toISOString().slice(0, 10);
    if (input.action === "revoke") {
      const { data: existing, error: readError } = await service.from("os_approval_assignments")
        .select("id,kind,delegated_by,revoked_at").eq("id", input.assignmentId).maybeSingle();
      if (readError || !existing) throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "승인자 설정을 찾을 수 없습니다.");
      if (actor.role !== "admin" && !(existing.kind === "delegate" && existing.delegated_by === actor.id)) {
        throw new ApiError(403, "APPROVER_ADMIN_REQUIRED", "관리자 또는 해당 위임을 설정한 승인자만 해제할 수 있습니다.");
      }
      if (existing.revoked_at) return NextResponse.json({ assignment: existing });
      const { data, error } = await service.from("os_approval_assignments").update({ revoked_at: new Date().toISOString() })
        .eq("id", existing.id).is("revoked_at", null).select("id,user_id,kind,delegated_by,starts_on,ends_on,revoked_at").single();
      if (error) throw new ApiError(409, "ASSIGNMENT_REVOKE_FAILED", "승인자 설정 해제를 다시 시도해 주세요.");
      return NextResponse.json({ assignment: data });
    }
    const { data: target, error: targetError } = await service.from("os_profiles")
      .select("id,is_active").eq("id", input.userId).maybeSingle();
    if (targetError || !target?.is_active) throw new ApiError(400, "ACTIVE_MEMBER_REQUIRED", "활성 구성원만 지정할 수 있습니다.");
    if (input.action === "add_approver") {
      if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 승인자를 지정할 수 있습니다.");
      const { data, error } = await service.from("os_approval_assignments")
        .insert({ user_id: input.userId, kind: "approver", created_by: actor.id })
        .select("id,user_id,kind,delegated_by,starts_on,ends_on,revoked_at").single();
      if (error) throw new ApiError(409, "APPROVER_ASSIGNMENT_FAILED", "이미 승인자로 지정되었거나 저장할 수 없습니다.");
      return NextResponse.json({ assignment: data }, { status: 201 });
    }
    if (input.userId === actor.id) throw new ApiError(400, "SELF_DELEGATION_FORBIDDEN", "자기 자신에게 위임할 수 없습니다.");
    if (input.startsOn > input.endsOn) throw new ApiError(400, "INVALID_DELEGATION_PERIOD", "위임 종료일은 시작일 이후여야 합니다.");
    const { data: assignments, error: assignmentError } = await service.from("os_approval_assignments")
      .select("user_id,kind,starts_on,ends_on,revoked_at").eq("kind", "approver").is("revoked_at", null);
    if (assignmentError) throw new ApiError(503, "APPROVAL_SETUP_PENDING", "현재 승인자를 확인할 수 없습니다.");
    const approverIds = (assignments ?? []).filter((row) => activeToday(row, today)).map((row) => row.user_id);
    const { data: activeProfiles, error: activeError } = await service.from("os_profiles")
      .select("id").in("id", approverIds.length ? approverIds : [actor.id]).eq("is_active", true);
    if (activeError) throw new ApiError(503, "APPROVAL_SETUP_PENDING", "현재 승인자를 확인할 수 없습니다.");
    const active = (assignments ?? []).filter((row) => activeToday(row, today) && activeProfiles?.some((profile) => profile.id === row.user_id));
    if (!(active.some((row) => row.user_id === actor.id) || (active.length === 0 && actor.role === "admin"))) {
      throw new ApiError(403, "APPROVER_REQUIRED", "현재 승인자만 위임할 수 있습니다.");
    }
    const { data, error } = await service.from("os_approval_assignments")
      .insert({ user_id: input.userId, kind: "delegate", delegated_by: actor.id,
        starts_on: input.startsOn, ends_on: input.endsOn, created_by: actor.id })
      .select("id,user_id,kind,delegated_by,starts_on,ends_on,revoked_at").single();
    if (error) throw new ApiError(400, "DELEGATION_FAILED", "위임을 저장하지 못했습니다.");
    return NextResponse.json({ assignment: data }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_APPROVAL_INPUT", "승인자 설정을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
