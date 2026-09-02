import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { COMPANY_ROSTER } from "@/lib/company-roster";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { getInitialPassword, writeSecurityAudit } from "@/lib/server/account-security";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const accountSchema = z.object({
  legalName: z.string().trim().min(1).max(120),
  nickname: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
});

export async function POST(request: Request) {
  let createdUserId: string | null = null;
  try {
    const actor = await authenticateRequest(request);
    if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 직원 계정을 발급할 수 있습니다.");
    const input = accountSchema.parse(await parseJson(request, 8_000));
    const roster = COMPANY_ROSTER.find((person) => person.name === input.nickname);
    if (!roster) throw new ApiError(404, "ROSTER_MEMBER_NOT_FOUND", "구성원에 등록된 닉네임과 정확히 일치하지 않습니다.");

    const service = createServiceSupabase();
    const { data: existingProfile } = await service.from("os_profiles")
      .select("id,email,display_name")
      .or(`email.eq.${input.email},display_name.eq.${input.nickname}`)
      .limit(1).maybeSingle();
    if (existingProfile) throw new ApiError(409, "MEMBER_ACCOUNT_EXISTS", "이미 연결된 이메일 또는 닉네임 계정이 있습니다.");

    const initialPassword = getInitialPassword();
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email: input.email,
      password: initialPassword,
      email_confirm: true,
      user_metadata: { display_name: input.nickname, legal_name: input.legalName },
    });
    if (createError || !created.user) throw new ApiError(400, "ACCOUNT_CREATE_FAILED", "직원 로그인 계정을 만들지 못했습니다.", createError?.message);
    createdUserId = created.user.id;

    const { data: directory } = await service.from("os_records")
      .select("team,brand,metadata")
      .eq("record_type", "company_setting")
      .contains("tags", ["member-directory"])
      .contains("metadata", { rosterName: input.nickname })
      .is("archived_at", null).maybeSingle();
    const metadata = (directory?.metadata ?? {}) as Record<string, unknown>;
    const { error: profileError } = await service.from("os_profiles").upsert({
      id: createdUserId,
      email: input.email,
      display_name: input.nickname,
      legal_name: input.legalName,
      role: "member",
      team: directory?.team ?? "",
      affiliation: directory?.brand ?? roster.affiliation,
      roles: Array.isArray(metadata.roles) ? metadata.roles.map(String) : [...roster.roles],
      onboarding: { ...(typeof metadata.onboarding === "object" && metadata.onboarding ? metadata.onboarding : {}), account: true },
      finance_access: false,
      is_active: true,
      must_change_password: true,
      password_reset_at: new Date().toISOString(),
      password_reset_by: actor.id,
    }, { onConflict: "id" });
    if (profileError) {
      await service.auth.admin.deleteUser(createdUserId);
      createdUserId = null;
      throw new ApiError(400, "PROFILE_CREATE_FAILED", "직원 권한 프로필을 만들지 못했습니다.", profileError.message);
    }
    await writeSecurityAudit({ actorId: actor.id, targetUserId: createdUserId, action: "account.created", note: `${input.nickname} 직원 계정을 발급했습니다.` });
    return NextResponse.json({ account: { id: createdUserId, email: input.email, displayName: input.nickname, legalName: input.legalName, role: "member", mustChangePassword: true } }, { status: 201 });
  } catch (error) {
    if (createdUserId) await createServiceSupabase().auth.admin.deleteUser(createdUserId);
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_ACCOUNT", "직원 계정 정보를 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
