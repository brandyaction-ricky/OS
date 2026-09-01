import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const service = createServiceSupabase();
    const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get("limit") ?? 100), 1), 200);
    let recordQuery = service.from("os_record_events")
      .select("id,record_id,actor_id,event_type,from_status,to_status,changed_fields,note,created_at,os_records(title,record_type)")
      .order("created_at", { ascending: false }).limit(limit * 2);
    let documentQuery = service.from("os_document_events")
      .select("id,document_id,actor_id,from_status,to_status,note,created_at")
      .order("created_at", { ascending: false }).limit(limit * 2);
    let agentQuery = service.from("os_agent_audit_logs")
      .select("id,agent_key_id,owner_user_id,action,document_id,record_id,title_snapshot,changed_fields,reason,created_at")
      .order("created_at", { ascending: false }).limit(limit * 2);
    if (actor.role !== "admin") {
      recordQuery = recordQuery.eq("actor_id", actor.id);
      documentQuery = documentQuery.eq("actor_id", actor.id);
      agentQuery = agentQuery.eq("owner_user_id", actor.id);
    }
    const [recordResult, documentResult, agentResult] = await Promise.all([recordQuery, documentQuery, agentQuery]);
    if (recordResult.error) throw new ApiError(400, "AUDIT_LIST_FAILED", "감사 로그를 불러오지 못했습니다.", recordResult.error.message);

    const documentIds = [...new Set([
      ...(documentResult.data ?? []).map((event) => event.document_id),
      ...(agentResult.data ?? []).map((event) => event.document_id),
    ].filter(Boolean))];
    const actorIds = [...new Set([
      ...(recordResult.data ?? []).map((event) => event.actor_id),
      ...(documentResult.data ?? []).map((event) => event.actor_id),
    ].filter(Boolean))];
    const agentKeyIds = [...new Set((agentResult.data ?? []).map((event) => event.agent_key_id).filter(Boolean))];
    const agentRecordIds = [...new Set((agentResult.data ?? []).map((event) => event.record_id).filter(Boolean))];
    const [documents, profiles, agentKeys, agentRecords] = await Promise.all([
      documentIds.length ? service.from("os_documents").select("id,title").in("id", documentIds) : Promise.resolve({ data: [] }),
      actorIds.length ? service.from("os_profiles").select("id,display_name,email").in("id", actorIds) : Promise.resolve({ data: [] }),
      agentKeyIds.length ? service.from("os_agent_keys").select("id,name").in("id", agentKeyIds) : Promise.resolve({ data: [] }),
      agentRecordIds.length ? service.from("os_records").select("id,title,record_type").in("id", agentRecordIds) : Promise.resolve({ data: [] }),
    ]);
    const documentNames = new Map((documents.data ?? []).map((document) => [document.id, document.title]));
    const profileNames = new Map((profiles.data ?? []).map((profile) => [profile.id, profile.display_name || profile.email || "구성원"]));
    const agentNames = new Map((agentKeys.data ?? []).map((key) => [key.id, key.name]));
    const agentRecordNames = new Map((agentRecords.data ?? []).map((record) => [record.id, record]));
    const records = (recordResult.data ?? []).map((event) => {
      const record = Array.isArray(event.os_records) ? event.os_records[0] : event.os_records;
      return ({
      id: `record:${event.id}`,
      subject_id: event.record_id,
      subject_type: record?.record_type ?? "record",
      title: record?.title ?? "운영 기록",
      actor_id: event.actor_id,
      actor_type: "user",
      actor_name: event.actor_id ? profileNames.get(event.actor_id) ?? "구성원" : "시스템",
      event_type: event.event_type,
      from_status: event.from_status,
      to_status: event.to_status,
      changed_fields: event.changed_fields ?? [],
      note: event.note ?? "",
      created_at: event.created_at,
    }); });
    const documentEvents = (documentResult.data ?? [])
      .filter((event) => !String(event.note ?? "").startsWith("MCP 에이전트 "))
      .map((event) => ({
        id: `document:${event.id}`,
        subject_id: event.document_id,
        subject_type: "knowledge_document",
        title: documentNames.get(event.document_id) ?? "지식 문서",
        actor_id: event.actor_id,
        actor_type: "user",
        actor_name: event.actor_id ? profileNames.get(event.actor_id) ?? "구성원" : "시스템",
        event_type: event.to_status === "archived" ? "archived" : "status_changed",
        from_status: event.from_status,
        to_status: event.to_status,
        changed_fields: ["status"],
        note: event.note ?? "",
        created_at: event.created_at,
      }));
    const agentEvents = (agentResult.data ?? []).map((event) => ({
      id: `agent:${event.id}`,
      subject_id: event.record_id || event.document_id,
      subject_type: event.record_id ? agentRecordNames.get(event.record_id)?.record_type ?? "record" : "knowledge_document",
      title: event.title_snapshot || (event.record_id ? agentRecordNames.get(event.record_id)?.title : documentNames.get(event.document_id)) || (event.record_id ? "운영 기록" : "지식 문서"),
      actor_id: event.agent_key_id,
      actor_type: "agent",
      actor_name: agentNames.get(event.agent_key_id) ?? "AI 에이전트",
      event_type: ({ "knowledge.create": "created", "knowledge.update": "updated", "knowledge.delete": "archived", "record.create": "created", "record.update": "updated", "record.delete": "archived", "record.restore": "restored" } as Record<string, string>)[event.action] ?? "updated",
      from_status: null,
      to_status: event.action.endsWith(".delete") ? "archived" : null,
      changed_fields: event.changed_fields ?? [],
      note: event.reason ?? "",
      created_at: event.created_at,
    }));
    const events = [...records, ...documentEvents, ...agentEvents]
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, limit);
    return NextResponse.json({ events });
  } catch (error) { return apiErrorResponse(error); }
}
