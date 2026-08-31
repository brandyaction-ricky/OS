import { NextResponse } from "next/server";
import { apiErrorResponse, ApiError } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateRequest(request, { allowAgent: true });
    const { id } = await params;
    const { data, error } = await createServiceSupabase().from("os_documents").select("*").eq("id", id).single();
    if (error || !data) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "문서를 찾을 수 없습니다.");
    if (actor.type === "agent" && (
      !actor.allowedStatuses.includes(data.status)
      || (data.status !== "canonical" && data.owner_id !== actor.ownerId)
    )) {
      throw new ApiError(403, "DOCUMENT_FORBIDDEN", "이 문서를 열 수 없습니다.");
    }
    return NextResponse.json({ document: data });
  } catch (error) { return apiErrorResponse(error); }
}
