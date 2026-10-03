import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

const schema = z.object({ documentId: z.string().uuid(), expectedVersion: z.number().int().positive(), stewardId: z.string().uuid().nullable() });

export async function PATCH(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 문서 담당을 지정할 수 있습니다.");
    const input = schema.parse(await parseJson(request, 8000));
    const { data, error } = await createServiceSupabase().rpc("os_set_document_steward", {
      p_actor: actor.id, p_document: input.documentId, p_expected_version: input.expectedVersion, p_steward: input.stewardId,
    });
    if (error?.message?.includes("VERSION_CONFLICT")) throw new ApiError(409, "VERSION_CONFLICT", "문서가 먼저 변경됐습니다. 새로고침 후 다시 지정해 주세요.");
    if (error?.code === "42883" || error?.code === "PGRST202") throw new ApiError(503, "STEWARD_SETUP_PENDING", "문서 담당 기능을 개발 DB에 적용해야 합니다.");
    if (error || !data) throw new ApiError(400, "STEWARD_UPDATE_FAILED", "문서 담당을 저장하지 못했습니다.");
    return NextResponse.json({ document: data });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_STEWARD", "문서 담당을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
