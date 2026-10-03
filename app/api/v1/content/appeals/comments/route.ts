import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({
  packageId: z.string().uuid(), expectedVersion: z.number().int().positive(),
  candidateSetVersion: z.string().max(80), index: z.number().int().min(0).max(11),
  body: z.string().trim().min(1).max(2000),
});

async function readableAppeal(actor: Awaited<ReturnType<typeof authenticateRequest>>, id: string) {
  const { data, error } = await actor.supabase.from("os_records")
    .select("id,version,record_type,metadata").eq("id", id).is("archived_at", null).maybeSingle();
  if (error || !data || data.record_type !== "content_package" || data.metadata?.packageKind !== "appeal_candidates") {
    throw new ApiError(404, "APPEAL_NOT_FOUND", "소구점 후보를 열 수 없습니다.");
  }
  return data;
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const id = z.string().uuid().parse(new URL(request.url).searchParams.get("packageId"));
    const appeal = await readableAppeal(actor, id);
    const version = String(appeal.metadata?.candidateSetVersion ?? "");
    const { data, error } = await createServiceSupabase().from("os_appeal_candidate_comments")
      .select("id,package_id,candidate_set_version,candidate_index,body,author_id,created_at")
      .eq("package_id", id).eq("candidate_set_version", version).order("created_at");
    if (error) throw new ApiError(error.code === "42P01" ? 503 : 400, "APPEAL_COMMENTS_FAILED", "소구점 댓글을 불러오지 못했습니다.");
    return NextResponse.json({ comments: data ?? [] });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_APPEAL", "소구점 후보 ID를 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = inputSchema.parse(await parseJson(request));
    const appeal = await readableAppeal(actor, input.packageId);
    if (appeal.version !== input.expectedVersion || String(appeal.metadata?.candidateSetVersion ?? "") !== input.candidateSetVersion) {
      throw new ApiError(409, "APPEAL_VERSION_CONFLICT", "후보 세트가 바뀌었습니다. 다시 불러와 댓글을 달아 주세요.");
    }
    const candidates = appeal.metadata?.result?.candidates;
    if (!Array.isArray(candidates) || input.index >= candidates.length) throw new ApiError(400, "APPEAL_CANDIDATE_NOT_FOUND", "댓글을 달 후보를 찾을 수 없습니다.");
    const { data, error } = await createServiceSupabase().from("os_appeal_candidate_comments")
      .insert({ package_id: input.packageId, candidate_set_version: input.candidateSetVersion,
        candidate_index: input.index, body: input.body, author_id: actor.id })
      .select("id,package_id,candidate_set_version,candidate_index,body,author_id,created_at").single();
    if (error || !data) throw new ApiError(error?.code === "42P01" ? 503 : 400, "APPEAL_COMMENT_FAILED", "댓글을 저장하지 못했습니다.");
    return NextResponse.json({ comment: data }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_APPEAL_COMMENT", "댓글을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
