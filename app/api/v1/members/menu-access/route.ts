import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { MENU_HREFS, isMissingMenuAccessTable } from "@/lib/menu-access";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  memberId: z.string().uuid(),
  allowedMenus: z.array(z.string().refine(href => MENU_HREFS.includes(href))).max(MENU_HREFS.length).nullable(),
  expectedVersion: z.number().int().min(0).max(2147483646),
}).strict();

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const all = new URL(request.url).searchParams.get("view") === "all";
    if (all && actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 전체 메뉴 설정을 볼 수 있습니다.");
    let query = actor.supabase.from("os_member_menu_access").select("member_id,allowed_menus,version");
    if (!all) query = query.eq("member_id", actor.id);
    const { data, error } = await query;
    if (isMissingMenuAccessTable(error)) return NextResponse.json({ policies: [], ready: false });
    if (error) throw new ApiError(503, "MENU_ACCESS_READ_FAILED", "메뉴 권한 설정을 불러오지 못했습니다. 다시 확인해 주세요.");
    return NextResponse.json({ policies: data ?? [], ready: true });
  } catch (error) { return apiErrorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 메뉴 권한을 설정할 수 있습니다.");
    const input = schema.parse(await parseJson(request));
    const service = createServiceSupabase();
    const { data: target, error: targetError } = await service.from("os_profiles")
      .select("id,role,is_active,finance_access").eq("id", input.memberId).maybeSingle();
    if (targetError) throw new ApiError(503, "MEMBER_READ_FAILED", "대상 계정을 확인하지 못했습니다.");
    if (!target?.is_active) throw new ApiError(404, "MEMBER_NOT_ACTIVE", "활성 로그인 계정만 설정할 수 있습니다.");
    if (target.role === "admin") throw new ApiError(400, "ADMIN_MENUS_PROTECTED", "관리자는 모든 메뉴에 접근합니다. 관리자 메뉴는 제한할 수 없습니다.");
    if (!target.finance_access && input.allowedMenus?.some(href => href.startsWith("/finance/"))) {
      throw new ApiError(400, "FINANCE_ACCESS_REQUIRED", "재무관리 메뉴는 구성원 정보에서 민감자료 권한을 부여한 뒤 선택해 주세요.");
    }
    const payload = {
      member_id: input.memberId, allowed_menus: input.allowedMenus ? [...new Set(["/home", ...input.allowedMenus])] : null,
      version: input.expectedVersion + 1, updated_by: actor.id, updated_at: new Date().toISOString(),
    };
    const query = input.expectedVersion === 0
      ? service.from("os_member_menu_access").insert(payload)
      : service.from("os_member_menu_access").update(payload).eq("member_id", input.memberId).eq("version", input.expectedVersion);
    const { data, error } = await query.select("member_id,allowed_menus,version").maybeSingle();
    if (isMissingMenuAccessTable(error)) throw new ApiError(503, "MENU_ACCESS_NOT_READY", "메뉴 권한 저장 준비가 완료되지 않았습니다. 아직 변경하지 않았습니다.");
    if (error?.code === "23505" || (!error && !data)) throw new ApiError(409, "MENU_ACCESS_CONFLICT", "다른 관리자가 먼저 변경했습니다. 최신 설정을 다시 불러와 주세요.");
    if (error) throw new ApiError(503, "MENU_ACCESS_SAVE_FAILED", "메뉴 권한을 저장하지 못했습니다.");
    return NextResponse.json({ policy: data });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_MENU_ACCESS", "선택한 메뉴를 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
