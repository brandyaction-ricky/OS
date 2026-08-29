import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { apiErrorResponse, ApiError, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { statusChangeSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateRequest(request);
    const { id } = await params;
    const input = statusChangeSchema.parse(await parseJson(request, 16_000));
    const { data, error } = await actor.supabase.rpc("os_set_document_status", {
      p_document_id: id,
      p_to: input.status,
      p_note: input.note,
    });
    if (error) throw new ApiError(400, "STATUS_CHANGE_FAILED", "문서 상태를 변경하지 못했습니다.", error.message);
    return NextResponse.json({ document: data });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_STATUS", "변경할 상태를 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
