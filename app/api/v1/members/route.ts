import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const memberUpdateSchema = z.object({
  id: z.string().uuid(),
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
    const { data, error } = await service.from("os_profiles")
      .select("id,email,display_name,role,team,affiliation,roles,onboarding,finance_access,is_active,created_at,updated_at")
      .order("display_name", { ascending: true });
    if (error) throw new ApiError(400, "MEMBER_LIST_FAILED", "구성원 목록을 불러오지 못했습니다.", error.message);
    return NextResponse.json({ members: data ?? [] });
  } catch (error) { return apiErrorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 구성원 권한을 변경할 수 있습니다.");
    const input = memberUpdateSchema.parse(await parseJson(request));
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
    }).eq("id", input.id).select("id,email,display_name,role,team,affiliation,roles,onboarding,finance_access,is_active,created_at,updated_at").single();
    if (error || !data) throw new ApiError(400, "MEMBER_UPDATE_FAILED", "구성원 정보를 수정하지 못했습니다.", error?.message);
    return NextResponse.json({ member: data });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_MEMBER", "구성원 정보를 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
