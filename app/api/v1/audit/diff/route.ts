import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { readableKnowledgePages } from "@/lib/server/knowledge-page-access";

const safeRecordFields = ["title", "description", "status", "priority", "stage", "brand", "team", "assignee_id", "due_date", "starts_at", "ends_at", "progress", "metric_target", "metric_current", "metric_unit", "amount", "currency", "source_url", "tags"] as const;

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const id = new URL(request.url).searchParams.get("eventId") ?? "";
    const service = createServiceSupabase();
    const recordMatch = /^record:(\d+)$/.exec(id);
    if (recordMatch) {
      const { data: event, error: eventError } = await service.from("os_record_events")
        .select("record_id,actor_id,snapshot").eq("id", Number(recordMatch[1])).maybeSingle();
      if (eventError || !event || (actor.role !== "admin" && event.actor_id !== actor.id)) throw new ApiError(404, "AUDIT_EVENT_NOT_FOUND", "변경 기록을 열 수 없습니다.");
      const { data: current, error: currentError } = await actor.supabase.from("os_records")
        .select("id,version,record_type").eq("id", event.record_id).maybeSingle();
      if (currentError || !current) throw new ApiError(404, "AUDIT_EVENT_NOT_FOUND", "변경 기록을 열 수 없습니다.");
      const version = Number(event.snapshot?.version ?? 0);
      if (!Number.isInteger(version) || version < 1) throw new ApiError(409, "AUDIT_VERSION_UNKNOWN", "이전 버전을 확인할 수 없습니다.");
      const { data: priorRows, error: priorError } = version > 1
        ? await service.from("os_record_events").select("snapshot").eq("record_id", event.record_id).eq("snapshot->>version", String(version - 1)).limit(1)
        : { data: [], error: null };
      if (priorError) throw new ApiError(400, "AUDIT_DIFF_FAILED", "이전 기록을 불러오지 못했습니다.");
      const before = priorRows?.[0]?.snapshot ?? null;
      const after = event.snapshot as Record<string, unknown>;
      const fields: Array<{ field: string; before: unknown; after: unknown }> = safeRecordFields.filter((field) => JSON.stringify(before?.[field]) !== JSON.stringify(after[field]))
        .map((field) => ({ field, before: before?.[field] ?? null, after: after[field] ?? null }));
      if (before && JSON.stringify(before.metadata) !== JSON.stringify(after.metadata)) {
        fields.push({ field: "metadata", before: "보안상 값 숨김", after: "보안상 값 숨김" });
      }
      return NextResponse.json({ kind: "record", subjectId: event.record_id, currentVersion: current.version,
        restoreVersion: before ? version - 1 : null, fields });
    }
    const documentMatch = /^version:([0-9a-f-]{36}):(\d+)$/.exec(id);
    if (documentMatch) {
      const documentId = documentMatch[1], versionNo = Number(documentMatch[2]);
      const { data: document, error: documentError } = await service.from("os_documents").select("*").eq("id", documentId).maybeSingle();
      if (documentError || !document || !(await readableKnowledgePages(actor, [document])).has(documentId)) {
        throw new ApiError(404, "AUDIT_EVENT_NOT_FOUND", "문서 변경 기록을 열 수 없습니다.");
      }
      const { data: versions, error: versionError } = await service.from("os_document_versions")
        .select("version_no,title,content_md").eq("document_id", documentId).in("version_no", [versionNo - 1, versionNo]);
      if (versionError) throw new ApiError(400, "AUDIT_DIFF_FAILED", "문서 버전을 불러오지 못했습니다.");
      const before = versions?.find((version) => version.version_no === versionNo - 1);
      const after = versions?.find((version) => version.version_no === versionNo);
      if (!after) throw new ApiError(404, "AUDIT_VERSION_UNKNOWN", "문서 버전을 찾을 수 없습니다.");
      return NextResponse.json({ kind: "document", subjectId: documentId, currentVersion: document.current_version,
        restoreVersion: before?.version_no ?? null,
        before: before ? { title: before.title, content: before.content_md } : null,
        after: { title: after.title, content: after.content_md } });
    }
    throw new ApiError(400, "AUDIT_DIFF_UNAVAILABLE", "이 변경 기록은 버전 차이를 제공하지 않습니다.");
  } catch (error) { return apiErrorResponse(error); }
}
