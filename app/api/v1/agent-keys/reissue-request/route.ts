import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { getDefaultOrganization } from "@/lib/server/organization";

const schema = z.object({ keyId: z.string().uuid(), recipientId: z.string().uuid() });

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 재발급을 요청할 수 있습니다.");
    const input = schema.parse(await parseJson(request, 8000));
    const service = createServiceSupabase();
    const organization = await getDefaultOrganization();
    const { data: key, error: keyError } = await service.from("os_agent_keys")
      .select("id,name,owner_user_id,active").eq("id", input.keyId).eq("organization_id", organization.id).maybeSingle();
    if (keyError || !key?.active) throw new ApiError(404, "AGENT_KEY_NOT_FOUND", "사용 중인 키를 찾지 못했습니다.");
    const { data: owner, error: ownerError } = await service.from("os_profiles")
      .select("id,is_shared_account").eq("id", key.owner_user_id).maybeSingle();
    if (ownerError) throw new ApiError(503, "SHARED_ACCOUNT_POLICY_PENDING", "공용 계정 표시 준비 중입니다.");
    if (!owner?.is_shared_account) throw new ApiError(400, "KEY_NOT_SHARED", "공용 계정에 귀속된 키가 아닙니다.");
    const { data: recipient, error: recipientError } = await service.from("os_profiles")
      .select("id,is_active,is_shared_account").eq("id", input.recipientId).maybeSingle();
    if (recipientError || !recipient?.is_active || recipient.is_shared_account || recipient.id === actor.id) {
      throw new ApiError(400, "REISSUE_RECIPIENT_INVALID", "재발급 요청을 받을 개인 구성원을 선택해 주세요.");
    }
    const { data: source, error: sourceError } = await service.from("os_records").insert({
      record_type: "access_rule", title: "AI 접근 키를 본인 계정으로 재발급 요청", description: "관리자가 개인 계정용 키를 새로 발급한 뒤 공용 계정 키 폐기를 검토합니다.",
      status: "active", owner_id: actor.id, assignee_id: recipient.id, created_by: actor.id, updated_by: actor.id,
      metadata: { kind: "agent_key_reissue_request", keyId: key.id, keyName: key.name },
    }).select("id,version").single();
    if (sourceError || !source) throw new ApiError(500, "REISSUE_REQUEST_FAILED", "재발급 요청을 기록하지 못했습니다.");
    const { error: noticeError } = await service.rpc("os_enqueue_work_notification", {
      recipient: recipient.id, actor: actor.id, source_type: "record", source_id: source.id,
      reason: "assignment", source_version: String(source.version),
    });
    if (noticeError) throw new ApiError(503, "REISSUE_NOTIFICATION_FAILED", "요청은 기록했지만 알림을 보내지 못했습니다. 다시 확인해 주세요.");
    const { error: auditError } = await service.from("os_security_audit_logs").insert({
      actor_id: actor.id, target_user_id: recipient.id, action: "agent_key.reissue_requested",
      note: `공용 계정 AI 키 개인 재발급 요청 · ${key.name}`,
    });
    if (auditError) throw new ApiError(503, "REISSUE_AUDIT_FAILED", "요청과 알림은 저장됐지만 보안 감사 기록을 남기지 못했습니다.");
    return NextResponse.json({ requested: true, requestId: source.id }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_REISSUE_REQUEST", "재발급 요청을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
