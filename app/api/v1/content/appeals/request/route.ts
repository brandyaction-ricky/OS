import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { appealReadinessMissing } from "@/lib/content-appeal-readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ packageId: z.string().uuid(), expectedVersion: z.number().int().positive() });

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = schema.parse(await parseJson(request));
    const { data: appeal, error: appealError } = await actor.supabase.from("os_records")
      .select("id,parent_id,record_type,created_by,version,metadata")
      .eq("id", input.packageId).is("archived_at", null).maybeSingle();
    if (appealError || !appeal || appeal.record_type !== "content_package" || appeal.metadata?.packageKind !== "appeal_candidates") {
      throw new ApiError(404, "APPEAL_NOT_FOUND", "소구점 후보를 찾을 수 없습니다.");
    }
    if (appeal.version !== input.expectedVersion) throw new ApiError(409, "APPEAL_VERSION_CONFLICT", "후보 세트가 변경됐습니다. 다시 확인해 주세요.");
    const { data: topic, error: topicError } = await actor.supabase.from("os_records")
      .select("id,record_type,source_url,metadata").eq("id", appeal.parent_id).is("archived_at", null).maybeSingle();
    if (topicError || !topic || topic.record_type !== "content_topic") throw new ApiError(404, "APPEAL_TOPIC_NOT_FOUND", "연결된 주제를 열 수 없습니다.");
    const missing = appealReadinessMissing(topic);
    if (missing.length) throw new ApiError(409, "APPEAL_READINESS_INCOMPLETE", `승인 요청 전에 채워 주세요: ${missing.join(" · ")}`);
    const service = createServiceSupabase();
    const { data: profiles, error: profileError } = await service.from("os_profiles")
      .select("id").eq("is_active", true);
    if (profileError) throw new ApiError(503, "APPROVER_LOOKUP_FAILED", "승인자를 확인하지 못했습니다.");
    const decisions = await Promise.all((profiles ?? []).map(async (profile) => {
      const result = await service.rpc("os_can_approve", { p_actor: profile.id, p_author: appeal.created_by });
      if (result.error) throw new ApiError(503, "APPROVAL_SETUP_PENDING", "승인 규칙을 확인하지 못했습니다.");
      return result.data === true ? profile.id : null;
    }));
    const recipients = [...new Set(decisions.filter((id): id is string => Boolean(id) && id !== actor.id))];
    if (!recipients.length) throw new ApiError(409, "APPEAL_APPROVER_MISSING", "활성 승인자나 유효한 위임자가 없습니다. 회사 설정에서 지정해 주세요.");
    for (const recipient of recipients) {
      const { error } = await service.rpc("os_enqueue_work_notification", {
        recipient, actor: actor.id, source_type: "record", source_id: appeal.id,
        reason: "approval", source_version: String(appeal.version),
      });
      if (error) throw new ApiError(503, "APPEAL_NOTIFICATION_PENDING", "요청 알림을 모두 전달하지 못했습니다. 다시 시도해 주세요.");
    }
    return NextResponse.json({ requested: true, recipientCount: recipients.length });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_APPEAL_REQUEST", "소구점 후보를 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
