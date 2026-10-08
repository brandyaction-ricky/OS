import { ApiError } from "@/lib/http";
import { getInitialPassword } from "./account-security";
import { createServiceSupabase } from "@/lib/supabase/server";
import { hrRpc, HR_MESSAGES, type HrActor } from "./hr";
import type { z } from "zod";
import type { personSchema } from "@/lib/hr/schema";
/** Auth creation is compensated if the subsequent single database transaction fails. */
export async function issueMemberAccount(input: {
  email: string;
  legalName: string;
  nickname: string;
}) {
  const service = createServiceSupabase();
  const { data: existing, error: lookup } = await service
    .from("os_profiles")
    .select("id")
    .eq("email", input.email)
    .maybeSingle();
  if (lookup)
    throw new ApiError(
      503,
      "ACCOUNT_LOOKUP_FAILED",
      "기존 계정을 확인하지 못했습니다.",
    );
  if (existing) throw new ApiError(409, "EMAIL_TAKEN", HR_MESSAGES.EMAIL_TAKEN);
  const { data, error } = await service.auth.admin.createUser({
    email: input.email,
    password: getInitialPassword(),
    email_confirm: true,
    user_metadata: {
      display_name: input.nickname,
      legal_name: input.legalName,
    },
  });
  if (error || !data.user)
    throw new ApiError(
      400,
      "ACCOUNT_CREATE_FAILED",
      "로그인 계정을 만들지 못했습니다. 이메일과 계정 설정을 확인해 주세요.",
    );
  return data.user.id;
}
export async function registerHrPerson(
  actor: HrActor,
  input: z.infer<typeof personSchema>,
  issue: boolean,
  role: "member" | "lead" | "admin",
) {
  if (issue && actor.role !== "admin")
    throw new ApiError(403, "ADMIN_REQUIRED", HR_MESSAGES.ADMIN_REQUIRED);
  if (input.person_kind !== "employee" && !input.profile_id && !issue)
    throw new ApiError(400, "ACCOUNT_REQUIRED", HR_MESSAGES.ACCOUNT_REQUIRED);
  if (
    input.person_kind === "employee" &&
    (!input.hire_date || !input.legal_name || !input.contract)
  )
    throw new ApiError(
      400,
      "LEGAL_NAME_REQUIRED",
      "실명·입사일·근로 조건을 입력해 주세요.",
    );
  let created: string | null = null;
  try {
    if (issue && !input.profile_id) {
      if (!input.email)
        throw new ApiError(
          400,
          "EMAIL_REQUIRED",
          "로그인 이메일을 입력해 주세요.",
        );
      created = await issueMemberAccount({
        email: input.email,
        legalName: input.legal_name || input.display_name,
        nickname: input.display_name,
      });
    }
    const id = await hrRpc<string>(actor, "os_hr_register_person", {
      p_payload: { ...input, profile_id: created || input.profile_id || null },
      p_role: role,
      p_issued: !!created,
    });
    return { id };
  } catch (error) {
    if (created) {
      const { error: cleanup } =
        await createServiceSupabase().auth.admin.deleteUser(created);
      if (cleanup)
        throw new ApiError(
          503,
          "ACCOUNT_CLEANUP_REQUIRED",
          "인사 등록에 실패했고 임시 계정 정리가 필요합니다. 관리자에게 알려 주세요.",
        );
    }
    throw error;
  }
}
export async function issueHrAccount(
  actor: HrActor,
  employee: string,
  expectedVersion: number,
) {
  if (actor.role !== "admin")
    throw new ApiError(403, "ADMIN_REQUIRED", HR_MESSAGES.ADMIN_REQUIRED);
  const input = await hrRpc<{
    email: string;
    legal_name: string;
    display_name: string;
  }>(actor, "os_hr_account_input", { p_employee: employee });
  if (!input.email)
    throw new ApiError(
      400,
      "EMAIL_REQUIRED",
      "정보 수정에서 이메일을 먼저 등록해 주세요.",
    );
  const id = await issueMemberAccount({
    email: input.email,
    legalName: input.legal_name,
    nickname: input.display_name,
  });
  try {
    await hrRpc(actor, "os_hr_link_account", {
      p_employee: employee,
      p_profile: id,
      p_version: expectedVersion,
    });
    return { id };
  } catch (error) {
    const { error: cleanup } =
      await createServiceSupabase().auth.admin.deleteUser(id);
    if (cleanup)
      throw new ApiError(
        503,
        "ACCOUNT_CLEANUP_REQUIRED",
        "계정 연결에 실패했고 임시 계정 정리가 필요합니다.",
      );
    throw error;
  }
}
