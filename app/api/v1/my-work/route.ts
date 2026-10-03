import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { buildPersonalWork } from "@/lib/personal-work";
import type { OsRecord } from "@/lib/record-types";
import type { KnowledgeDocument } from "@/lib/types";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const [operating, documents] = await Promise.all([
      actor.supabase.from("os_records").select("*", { count: "exact" }).in("record_type", ["task", "ai_job", "leave_request", "decision"])
        .or(`assignee_id.eq.${actor.id},created_by.eq.${actor.id}`).is("archived_at", null).order("updated_at", { ascending: false }).limit(1000),
      actor.supabase.from("os_documents").select("id,title,status,owner_id", { count: "exact" }).in("status", ["review", "reviewed"]).order("updated_at", { ascending: false }).limit(1000),
    ]);
    if (operating.error || documents.error) throw new ApiError(500, "MY_WORK_FAILED", "내 할 일을 불러오지 못했습니다.");
    return NextResponse.json({ tabs: buildPersonalWork((operating.data ?? []) as OsRecord[], (documents.data ?? []) as KnowledgeDocument[], actor.id, actor.role === "admin"),
      truncated: (operating.count ?? 0) > 1000 || (documents.count ?? 0) > 1000, checkedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
