import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { COMPANY_ROSTER, memberMatchesRoster, rosterDirectoryId } from "@/lib/company-roster";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const memberUpdateSchema = z.object({
  id: z.union([z.string().uuid(), z.string().regex(/^directory:/)]),
  displayName: z.string().trim().min(1).max(120),
  role: z.enum(["member", "lead", "admin"]),
  team: z.string().trim().max(120),
  affiliation: z.string().trim().max(120),
  roles: z.array(z.string().trim().min(1).max(80)).max(12),
  onboarding: z.record(z.string(), z.boolean()),
  financeAccess: z.boolean(),
  isActive: z.boolean(),
});

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);
    const service = createServiceSupabase();
    const [profileResult, directoryResult] = await Promise.all([
      service.from("os_profiles")
        .select("id,email,display_name,legal_name,role,team,affiliation,roles,onboarding,finance_access,is_active,must_change_password,created_at,updated_at")
        .order("display_name", { ascending: true }),
      service.from("os_records")
        .select("id,title,team,brand,metadata,created_at,updated_at")
        .eq("record_type", "company_setting")
        .contains("tags", ["member-directory"])
        .is("archived_at", null),
    ]);
    if (profileResult.error) throw new ApiError(400, "MEMBER_LIST_FAILED", "구성원 목록을 불러오지 못했습니다.", profileResult.error.message);
    if (directoryResult.error) throw new ApiError(400, "MEMBER_DIRECTORY_FAILED", "초대 구성원 정보를 불러오지 못했습니다.", directoryResult.error.message);
    const profiles = (profileResult.data ?? []).map((member) => ({ ...member, account_connected: true }));
    const directoryByName = new Map((directoryResult.data ?? []).map((item) => [String(item.metadata?.rosterName ?? item.title), item]));
    const pending = COMPANY_ROSTER
      .filter((person) => !profiles.some((member) => memberMatchesRoster(member, person.name)))
      .map((person) => {
        const saved = directoryByName.get(person.name);
        const metadata = (saved?.metadata ?? {}) as Record<string, unknown>;
        return {
          id: rosterDirectoryId(person.name), email: "", display_name: String(metadata.displayName ?? person.name), legal_name: "", role: "member",
          team: saved?.team ?? "", affiliation: saved?.brand ?? person.affiliation,
          roles: Array.isArray(metadata.roles) ? metadata.roles.map(String) : [...person.roles],
          onboarding: typeof metadata.onboarding === "object" && metadata.onboarding ? metadata.onboarding : {},
          finance_access: Boolean(metadata.financeAccess), is_active: false, must_change_password: true, account_connected: false,
          created_at: saved?.created_at ?? "", updated_at: saved?.updated_at ?? "",
        };
      });
    return NextResponse.json({ members: [...profiles, ...pending] });
  } catch (error) { return apiErrorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 구성원 권한을 변경할 수 있습니다.");
    const input = memberUpdateSchema.parse(await parseJson(request));
    if (input.id.startsWith("directory:")) {
      const rosterName = decodeURIComponent(input.id.slice("directory:".length));
      const roster = COMPANY_ROSTER.find((person) => person.name === rosterName);
      if (!roster) throw new ApiError(404, "ROSTER_MEMBER_NOT_FOUND", "초대 구성원을 찾지 못했습니다.");
      const service = createServiceSupabase();
      const { data: current, error: readError } = await service.from("os_records")
        .select("id,version").eq("record_type", "company_setting")
        .contains("tags", ["member-directory"]).contains("metadata", { rosterName })
        .is("archived_at", null).maybeSingle();
      if (readError) throw new ApiError(400, "MEMBER_DIRECTORY_READ_FAILED", "초대 구성원 정보를 확인하지 못했습니다.", readError.message);
      const payload = {
        title: `${rosterName} 구성원 정보`, description: "로그인 계정 연결 전 구성원 디렉터리", status: "active",
        team: input.team, brand: input.affiliation, tags: ["member-directory"],
        metadata: { rosterName, displayName: input.displayName, roles: input.roles, onboarding: input.onboarding, financeAccess: input.financeAccess },
        updated_by: actor.id,
      };
      const result = current
        ? await service.from("os_records").update(payload).eq("id", current.id).eq("version", current.version).select("id").single()
        : await service.from("os_records").insert({ ...payload, record_type: "company_setting", owner_id: actor.id, created_by: actor.id }).select("id").single();
      if (result.error) throw new ApiError(400, "MEMBER_DIRECTORY_UPDATE_FAILED", "초대 구성원 정보를 저장하지 못했습니다.", result.error.message);
      return NextResponse.json({ member: { ...input, account_connected: false } });
    }
    if (input.id === actor.id && (!input.isActive || input.role !== "admin")) {
      throw new ApiError(400, "SELF_ADMIN_PROTECTED", "현재 로그인한 관리자 자신의 권한은 낮추거나 중지할 수 없습니다.");
    }
    const service = createServiceSupabase();
    const { data, error } = await service.from("os_profiles").update({
      display_name: input.displayName,
      role: input.role,
      team: input.team,
      affiliation: input.affiliation,
      roles: input.roles,
      onboarding: input.onboarding,
      finance_access: input.financeAccess,
      is_active: input.isActive,
      updated_at: new Date().toISOString(),
    }).eq("id", input.id).select("id,email,display_name,legal_name,role,team,affiliation,roles,onboarding,finance_access,is_active,must_change_password,created_at,updated_at").single();
    if (error || !data) throw new ApiError(400, "MEMBER_UPDATE_FAILED", "구성원 정보를 수정하지 못했습니다.", error?.message);
    return NextResponse.json({ member: data });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_MEMBER", "구성원 정보를 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
