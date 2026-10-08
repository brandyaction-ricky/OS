import { NextResponse } from "next/server";
import { apiErrorResponse, ApiError } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { readableKnowledgePages } from "@/lib/server/knowledge-page-access";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateRequest(request, { allowAgent: true });
    const { id } = await params;
    const { data, error } = await createServiceSupabase().from("os_documents").select("*").eq("id", id).single();
    if (error || !data) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "이 문서를 볼 권한이 없습니다.");
    if (!(await readableKnowledgePages(actor, [data])).has(data.id)) {
      throw new ApiError(404, "DOCUMENT_NOT_FOUND", "이 문서를 볼 권한이 없습니다.");
    }
    return NextResponse.json({ document: data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
