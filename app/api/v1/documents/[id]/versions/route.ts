import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { apiErrorResponse, ApiError, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const restoreSchema = z.object({
  version: z.number().int().positive(),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().max(500).optional().default(""),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateRequest(request);
    const { id } = await params;
    const { data, error } = await actor.supabase.rpc("os_get_document_versions", { p_document_id: id });
    if (error) throw new ApiError(400, "DOCUMENT_VERSIONS_FAILED", "변경 이력을 불러오지 못했습니다.", error.message);
    return NextResponse.json({ versions: data ?? [] });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateRequest(request);
    const { id } = await params;
    const input = restoreSchema.parse(await parseJson(request, 16_000));
    const { data, error } = await actor.supabase.rpc("os_restore_document_version", {
      p_document_id: id,
      p_version_no: input.version,
      p_expected_version: input.expectedVersion,
      p_reason: input.reason,
    });
    if (error) throw new ApiError(400, "DOCUMENT_RESTORE_FAILED", "이 버전으로 되돌리지 못했습니다.", error.message);
    return NextResponse.json({ document: data });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_VERSION", "되돌릴 버전을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
