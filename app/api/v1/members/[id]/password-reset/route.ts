import { NextResponse } from "next/server";
import { z } from "zod";
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
      .select("id,display_name,email,must_change_password,is_active")
      .eq("id", targetId).maybeSingle();
    if (targetError || !target) throw new ApiError(404, "MEMBER_NOT_FOUND", "초기화할 구성원 계정을 찾지 못했습니다.");
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
      await service.from("os_profiles").update({ must_change_password: target.must_change_password }).eq("id", targetId);
      throw new ApiError(400, "PASSWORD_RESET_FAILED", "비밀번호를 초기화하지 못했습니다.", resetError.message);
    }
    await writeSecurityAudit({ actorId: actor.id, targetUserId: targetId, action: "password.reset", note: `${target.display_name || target.email} 계정을 최초 비밀번호로 초기화했습니다.` });
    return NextResponse.json({ reset: true, member: { id: targetId, displayName: target.display_name, email: target.email, mustChangePassword: true } });
  } catch (error) { return apiErrorResponse(error); }
}
