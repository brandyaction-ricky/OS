import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { apiErrorResponse, ApiError, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const restoreSchema = z.object({
  version: z.number().int().positive(),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().max(500).optional().default(""),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await authenticateRequest(request);
    const { id } = await params;
    const service = createServiceSupabase();
    const { data, error } = await service.from("os_document_versions").select("version_no,title,content_md,author_id,reason,created_at").eq("document_id", id).order("version_no", { ascending: false });
    if (error) throw new ApiError(400, "DOCUMENT_VERSIONS_FAILED", "변경 이력을 불러오지 못했습니다.", error.message);
    const authorIds = [...new Set((data ?? []).map((version) => version.author_id).filter(Boolean))];
    const { data: authors } = authorIds.length ? await service.from("os_profiles").select("id,display_name,email").in("id", authorIds) : { data: [] };
    const names = new Map((authors ?? []).map((author) => [author.id, author.display_name || author.email || "초기 가져오기"]));
    return NextResponse.json({ versions: (data ?? []).map((version) => ({ ...version, author_name: version.author_id ? names.get(version.author_id) ?? "구성원" : "초기 가져오기" })) });
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
