import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { getInitialPassword, writeSecurityAudit } from "@/lib/server/account-security";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateRequest(request);
    if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 비밀번호를 초기화할 수 있습니다.");
    const targetId = z.string().uuid().parse((await context.params).id);
    if (targetId === actor.id) throw new ApiError(400, "SELF_PASSWORD_RESET_FORBIDDEN", "현재 로그인한 관리자 계정은 본인 변경 화면을 이용해 주세요.");
    const service = createServiceSupabase();
    const { data: target, error: targetError } = await service.from("os_profiles")
      .select("id,display_name,email,must_change_password,is_active,password_reset_at,password_reset_by")
      .eq("id", targetId).maybeSingle();
    if (targetError) throw new ApiError(500, "MEMBER_LOOKUP_FAILED", "초기화할 구성원 정보를 확인하지 못했습니다.");
    if (!target) throw new ApiError(404, "MEMBER_NOT_FOUND", "초기화할 구성원 계정을 찾지 못했습니다.");
    if (!target.is_active) throw new ApiError(400, "ACCOUNT_DISABLED", "사용 중지 계정은 먼저 활성화해 주세요.");

    const initialPassword = getInitialPassword();
    const resetAt = new Date().toISOString();
    const { error: stateError } = await service.from("os_profiles").update({
      must_change_password: true,
      password_reset_at: resetAt,
      password_reset_by: actor.id,
    }).eq("id", targetId);
    if (stateError) throw new ApiError(400, "PASSWORD_STATE_FAILED", "비밀번호 초기화 상태를 저장하지 못했습니다.", stateError.message);

    const { error: resetError } = await service.auth.admin.updateUserById(targetId, { password: initialPassword });
    if (resetError) {
      // Restore only this attempt: a newer reset or password change must retain its state.
      const { error: rollbackError } = await service.from("os_profiles").update({
        must_change_password: target.must_change_password,
        password_reset_at: target.password_reset_at,
        password_reset_by: target.password_reset_by,
      }).eq("id", targetId).eq("password_reset_at", resetAt).eq("password_reset_by", actor.id).eq("must_change_password", true);
      if (rollbackError) throw new ApiError(500, "PASSWORD_RESET_RECOVERY_FAILED", "비밀번호 초기화에 실패했고 변경 대기 상태를 복원하지 못했습니다. 구성원 상태를 다시 확인해 주세요.");
      throw new ApiError(400, "PASSWORD_RESET_FAILED", "비밀번호를 초기화하지 못했습니다.", resetError.message);
    }
    await writeSecurityAudit({ actorId: actor.id, targetUserId: targetId, action: "password.reset", note: `${target.display_name || target.email} 계정을 최초 비밀번호로 초기화했습니다.` });
    return NextResponse.json({ reset: true, member: { id: targetId, displayName: target.display_name, email: target.email, mustChangePassword: true } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_MEMBER_ID", "초기화할 구성원 ID를 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
