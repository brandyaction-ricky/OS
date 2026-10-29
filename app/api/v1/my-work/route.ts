import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { buildPersonalWork } from "@/lib/personal-work";
import type { OsRecord } from "@/lib/record-types";
import type { KnowledgeDocument } from "@/lib/types";
export const dynamic = "force-dynamic";
// Only what buildPersonalWork reads. AI-job rows carry several KB of prompt/result each, and the home page waited
// about 2 seconds for up to 1000 of them in full; the metadata keys come back as single JSON values instead.
const META_KEYS = ["kind", "nextAction", "doneCriteria", "origin", "studioKind", "packageKind", "sourceId", "contentId"] as const;
const RECORD_COLUMNS = ["id,record_type,title,status,due_date,assignee_id,created_by,updated_at,archived_at", ...META_KEYS.map(key => `m_${key}:metadata->${key}`)].join(",");
const LIMIT = 1000;
export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const [operating, documents] = await Promise.all([
      actor.supabase.from("os_records").select(RECORD_COLUMNS).in("record_type", ["task", "ai_job", "leave_request", "decision"])
        .or(`assignee_id.eq.${actor.id},created_by.eq.${actor.id}`).is("archived_at", null).order("updated_at", { ascending: false }).limit(LIMIT + 1),
      actor.supabase.from("os_documents").select("id,title,status,owner_id").in("status", ["review", "reviewed"]).order("updated_at", { ascending: false }).limit(LIMIT + 1),
    ]);
    if (operating.error || documents.error) throw new ApiError(500, "MY_WORK_FAILED", "내 할 일을 불러오지 못했습니다.");
    const records = ((operating.data ?? []) as unknown as Array<Record<string, unknown>>).slice(0, LIMIT).map(row => {
      const metadata = Object.fromEntries(META_KEYS.filter(key => row[`m_${key}`] != null).map(key => [key, row[`m_${key}`]]));
      return { ...row, description: "", metadata } as unknown as OsRecord;
    });
    return NextResponse.json({ tabs: buildPersonalWork(records, ((documents.data ?? []) as KnowledgeDocument[]).slice(0, LIMIT), actor.id, actor.role === "admin"),
      truncated: (operating.data?.length ?? 0) > LIMIT || (documents.data?.length ?? 0) > LIMIT, checkedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
