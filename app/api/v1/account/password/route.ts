import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { managedPasswordSchema, getInitialPassword, writeSecurityAudit } from "@/lib/server/account-security";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createCredentialSupabase, createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(6).max(72),
  newPassword: managedPasswordSchema,
});

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request, { allowPasswordChangeRequired: true });
    if (!actor.user?.email) throw new ApiError(400, "ACCOUNT_EMAIL_REQUIRED", "계정 이메일을 확인하지 못했습니다.");
    const input = passwordChangeSchema.parse(await parseJson(request, 8_000));
    if (input.currentPassword === input.newPassword) {
      throw new ApiError(400, "PASSWORD_UNCHANGED", "현재 비밀번호와 다른 비밀번호를 입력해 주세요.");
    }
    const initialPassword = getInitialPassword();
    if (input.newPassword === initialPassword) {
      throw new ApiError(400, "INITIAL_PASSWORD_REUSE", "최초 비밀번호가 아닌 개인 비밀번호를 입력해 주세요.");
    }

    const verified = createCredentialSupabase();
    const { data: signIn, error: signInError } = await verified.auth.signInWithPassword({
      email: actor.user.email,
      password: input.currentPassword,
    });
    if (signInError || signIn.user?.id !== actor.id) {
      throw new ApiError(400, "CURRENT_PASSWORD_INVALID", "현재 비밀번호가 올바르지 않습니다.");
    }
    const { error: passwordError } = await verified.auth.updateUser({ password: input.newPassword });
    if (passwordError) throw new ApiError(400, "PASSWORD_CHANGE_FAILED", "비밀번호를 변경하지 못했습니다.", passwordError.message);

    const changedAt = new Date().toISOString();
    const { error: profileError } = await createServiceSupabase().from("os_profiles").update({
      must_change_password: false,
      password_changed_at: changedAt,
    }).eq("id", actor.id);
    if (profileError) throw new ApiError(500, "PASSWORD_STATE_FAILED", "비밀번호 변경 상태를 저장하지 못했습니다.", profileError.message);
    await writeSecurityAudit({ actorId: actor.id, targetUserId: actor.id, action: "password.changed", note: "구성원이 본인 비밀번호를 변경했습니다." });

    await verified.auth.signOut({ scope: "others" });
    return NextResponse.json({ changed: true, reloginRequired: true });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_PASSWORD", "비밀번호 조건을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
