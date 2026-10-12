import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { buildPersonalWork, type PersonalWorkDocument, type PersonalWorkRecord } from "@/lib/personal-work";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const [operating, documents] = await Promise.all([
      actor.supabase.from("os_records").select("id,record_type,title,status,assignee_id,created_by,due_date,updated_at,archived_at,metadata,parent_id").in("record_type", ["task", "ai_job", "leave_request", "decision"])
        .or(`assignee_id.eq.${actor.id},created_by.eq.${actor.id}`).is("archived_at", null).order("updated_at", { ascending: false }).limit(1001),
      actor.supabase.from("os_documents").select("id,title,status,owner_id").in("status", ["review", "reviewed"]).order("updated_at", { ascending: false }).limit(1001),
    ]);
    if (operating.error || documents.error) throw new ApiError(500, "MY_WORK_FAILED", "내 할 일을 불러오지 못했습니다.");
    return NextResponse.json({ tabs: buildPersonalWork((operating.data ?? []).slice(0,1000) as PersonalWorkRecord[], (documents.data ?? []).slice(0,1000) as PersonalWorkDocument[], actor.id, actor.role === "admin"),
      truncated: (operating.data?.length ?? 0) > 1000 || (documents.data?.length ?? 0) > 1000, checkedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
