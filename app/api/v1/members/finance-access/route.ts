import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  memberId: z.string().uuid(),
  financeAccess: z.boolean(),
  expectedFinanceAccess: z.boolean(),
}).strict();

export async function PATCH(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 민감정보 접근 권한을 변경할 수 있습니다.");
    const input = schema.parse(await parseJson(request));
    const service = createServiceSupabase();
    const { data: target, error: readError } = await service.from("os_profiles")
      .select("id,role,is_active,finance_access").eq("id", input.memberId).maybeSingle();
    if (readError) throw new ApiError(503, "MEMBER_READ_FAILED", "대상 계정을 확인하지 못했습니다.");
    if (!target?.is_active) throw new ApiError(404, "MEMBER_NOT_ACTIVE", "활성 로그인 계정만 설정할 수 있습니다.");
    if (target.role === "admin") throw new ApiError(400, "ADMIN_ACCESS_PROTECTED", "관리자는 모든 메뉴와 자료에 접근합니다.");
    if (target.finance_access !== input.expectedFinanceAccess) throw new ApiError(409, "FINANCE_ACCESS_CONFLICT", "다른 관리자가 권한을 변경했습니다. 화면을 새로고침해 주세요.");
    const { data, error } = await service.from("os_profiles")
      .update({ finance_access: input.financeAccess, updated_at: new Date().toISOString() })
      .eq("id", input.memberId).eq("finance_access", input.expectedFinanceAccess)
      .eq("is_active", true).neq("role", "admin")
      .select("id,finance_access").maybeSingle();
    if (error) throw new ApiError(503, "FINANCE_ACCESS_SAVE_FAILED", "민감정보 접근 권한을 저장하지 못했습니다.");
    if (!data) throw new ApiError(409, "FINANCE_ACCESS_CONFLICT", "계정이나 권한이 변경됐습니다. 화면을 새로고침해 주세요.");
    return NextResponse.json({ memberId: data.id, financeAccess: data.finance_access });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_FINANCE_ACCESS", "변경할 계정과 권한을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
