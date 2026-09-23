import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({ documentId: z.string().uuid() });
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const { data: project, error: projectError } = await actor.supabase.from("os_records")
      .select("id,title,metadata")
      .eq("record_type", "project")
      .eq("metadata->>developmentDocumentId", input.documentId)
      .is("archived_at", null)
      .maybeSingle();
    if (projectError) throw new ApiError(500, "DEVELOPMENT_PROJECT_LINK_FAILED", "문서와 연결된 개발 프로젝트를 확인하지 못했습니다.");
    if (!project) return NextResponse.json({ project: null, requests: [], history: [] }, { headers });

    const [requests, history] = await Promise.all([
      actor.supabase.from("os_records")
        .select("id,record_type,title,status,priority,assignee_id,updated_at")
        .eq("record_type", "ai_job").eq("metadata->>kind", "development_request")
        .eq("parent_id", project.id).is("archived_at", null)
        .order("updated_at", { ascending: false }).limit(100),
      actor.supabase.from("os_records")
        .select("id,record_type,title,description,status,stage,source_url,metadata,updated_at")
        .in("record_type", ["development_log", "deployment"])
        .eq("parent_id", project.id).is("archived_at", null)
        .order("updated_at", { ascending: false }).limit(50),
    ]);
    if (requests.error || history.error) throw new ApiError(500, "DEVELOPMENT_PROJECT_LOG_FAILED", "연결된 개발 기록을 불러오지 못했습니다.");
    return NextResponse.json({ project, requests: requests.data ?? [], history: history.data ?? [] }, { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_DEVELOPMENT_DOCUMENT", "개발 로그 문서를 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
