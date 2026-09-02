import { z } from "zod";
import { OS_INITIAL_PASSWORD } from "@/lib/config";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";

export const managedPasswordSchema = z.string()
  .min(10, "비밀번호는 10자 이상이어야 합니다.")
  .max(72, "비밀번호는 72자 이하여야 합니다.")
  .regex(/[A-Za-z]/, "영문자를 포함해 주세요.")
  .regex(/[0-9]/, "숫자를 포함해 주세요.")
  .regex(/[^A-Za-z0-9]/, "특수문자를 포함해 주세요.");

export function getInitialPassword() {
  if (!OS_INITIAL_PASSWORD || OS_INITIAL_PASSWORD.length < 10) {
    throw new ApiError(503, "INITIAL_PASSWORD_NOT_CONFIGURED", "최초 비밀번호가 서버에 설정되지 않았습니다.");
  }
  return OS_INITIAL_PASSWORD;
}

export async function writeSecurityAudit(input: {
  actorId: string | null;
  targetUserId: string;
  action: "account.created" | "password.changed" | "password.reset";
  note: string;
}) {
  const { error } = await createServiceSupabase().from("os_security_audit_logs").insert({
    actor_id: input.actorId,
    target_user_id: input.targetUserId,
    action: input.action,
    note: input.note,
  });
  if (error) throw new ApiError(500, "SECURITY_AUDIT_FAILED", "보안 감사 기록을 저장하지 못했습니다.", error.message);
}
