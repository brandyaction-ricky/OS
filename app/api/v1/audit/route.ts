import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { readableKnowledgePages } from "@/lib/server/knowledge-page-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuditRecord = {
  title?: string | null;
  record_type?: string | null;
  metadata?: Record<string, unknown> | null;
};

function auditSubjectType(record: AuditRecord | null | undefined) {
  return record?.record_type === "ai_job" && record.metadata?.kind === "development_request"
    ? "development_request"
    : record?.record_type ?? "record";
}

function dateBoundary(value: string | null, nextDay = false) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError(400, "INVALID_AUDIT_DATE", "조회 날짜를 확인해 주세요.");
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.toISOString().slice(0, 10) !== value) throw new ApiError(400, "INVALID_AUDIT_DATE", "조회 날짜를 확인해 주세요.");
  return new Date(Date.parse(`${value}T00:00:00+09:00`) + (nextDay ? 86_400_000 : 0)).toISOString();
}

function readCursor(value: string | null): { at: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { at?: unknown; id?: unknown };
    if (typeof parsed.at === "string" && !Number.isNaN(Date.parse(parsed.at))
      && typeof parsed.id === "string" && /^(record|document|agent|security):[\w-]+$|^version:[\w-]+:\d+$/.test(parsed.id)) {
      return { at: parsed.at, id: parsed.id };
    }
  } catch { /* Invalid cursors are rejected below. */ }
  throw new ApiError(400, "INVALID_AUDIT_CURSOR", "변경 기록 페이지 주소를 확인해 주세요.");
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const service = createServiceSupabase();
    const params = new URL(request.url).searchParams;
    const limit = Math.min(Math.max(Number(params.get("limit") ?? 100) || 100, 1), 200);
    const from = dateBoundary(params.get("from"));
    const to = dateBoundary(params.get("to"), true);
    if (from && to && from >= to) throw new ApiError(400, "INVALID_AUDIT_RANGE", "시작일이 종료일보다 늦습니다.");
    const cursor = readCursor(params.get("cursor"));
    const queryLimit = limit * 3;
    let recordQuery = service.from("os_record_events")
      .select("id,record_id,actor_id,event_type,from_status,to_status,changed_fields,note,created_at,os_records(title,record_type,metadata)")
      .order("created_at", { ascending: false }).limit(queryLimit);
    let documentQuery = service.from("os_document_events")
      .select("id,document_id,actor_id,from_status,to_status,note,created_at")
      .order("created_at", { ascending: false }).limit(queryLimit);
    let versionQuery = service.from("os_document_versions")
      .select("document_id,version_no,author_id,created_at")
      .gt("version_no", 1).order("created_at", { ascending: false }).limit(queryLimit);
    let agentQuery = service.from("os_agent_audit_logs")
      .select("id,agent_key_id,owner_user_id,action,document_id,record_id,title_snapshot,changed_fields,reason,created_at")
      .order("created_at", { ascending: false }).limit(queryLimit);
    let securityQuery = service.from("os_security_audit_logs")
      .select("id,actor_id,target_user_id,action,note,created_at")
      .order("created_at", { ascending: false }).limit(queryLimit);
    if (from) {
      recordQuery = recordQuery.gte("created_at", from);
      documentQuery = documentQuery.gte("created_at", from);
      versionQuery = versionQuery.gte("created_at", from);
      agentQuery = agentQuery.gte("created_at", from);
      securityQuery = securityQuery.gte("created_at", from);
    }
    if (to) {
      recordQuery = recordQuery.lt("created_at", to);
      documentQuery = documentQuery.lt("created_at", to);
      versionQuery = versionQuery.lt("created_at", to);
      agentQuery = agentQuery.lt("created_at", to);
      securityQuery = securityQuery.lt("created_at", to);
    }
    if (cursor) {
      recordQuery = recordQuery.lte("created_at", cursor.at);
      documentQuery = documentQuery.lte("created_at", cursor.at);
      versionQuery = versionQuery.lte("created_at", cursor.at);
      agentQuery = agentQuery.lte("created_at", cursor.at);
      securityQuery = securityQuery.lte("created_at", cursor.at);
    }
    if (actor.role !== "admin") {
      recordQuery = recordQuery.eq("actor_id", actor.id);
      documentQuery = documentQuery.eq("actor_id", actor.id);
      versionQuery = versionQuery.eq("author_id", actor.id);
      agentQuery = agentQuery.eq("owner_user_id", actor.id);
      securityQuery = securityQuery.or(`actor_id.eq.${actor.id},target_user_id.eq.${actor.id}`);
    }
    const [recordResult, documentResult, versionResult, agentResult, securityResult] = await Promise.all([recordQuery, documentQuery, versionQuery, agentQuery, securityQuery]);
    if (recordResult.error) throw new ApiError(400, "AUDIT_LIST_FAILED", "감사 로그를 불러오지 못했습니다.", recordResult.error.message);
    if (documentResult.error || versionResult.error || agentResult.error) throw new ApiError(400, "AUDIT_LIST_FAILED", "변경 기록을 불러오지 못했습니다.");
    if (securityResult.error) throw new ApiError(400, "SECURITY_AUDIT_LIST_FAILED", "계정 보안 기록을 불러오지 못했습니다.", securityResult.error.message);

    const documentIds = [...new Set([
      ...(documentResult.data ?? []).map((event) => event.document_id),
      ...(versionResult.data ?? []).map((event) => event.document_id),
      ...(agentResult.data ?? []).map((event) => event.document_id),
    ].filter(Boolean))];
    const actorIds = [...new Set([
      ...(recordResult.data ?? []).map((event) => event.actor_id),
      ...(documentResult.data ?? []).map((event) => event.actor_id),
      ...(versionResult.data ?? []).map((event) => event.author_id),
      ...(securityResult.data ?? []).flatMap((event) => [event.actor_id, event.target_user_id]),
    ].filter(Boolean))];
    const agentKeyIds = [...new Set((agentResult.data ?? []).map((event) => event.agent_key_id).filter(Boolean))];
    const agentRecordIds = [...new Set((agentResult.data ?? []).map((event) => event.record_id).filter(Boolean))];
    const [documentLookup, profiles, agentKeys, agentRecords] = await Promise.all([
      documentIds.length ? service.from("os_documents").select("id,title,status,owner_id,parent_document_id").in("id", documentIds) : Promise.resolve({ data: [], error: null }),
      actorIds.length ? service.from("os_profiles").select("id,display_name,email").in("id", actorIds) : Promise.resolve({ data: [] }),
      agentKeyIds.length ? service.from("os_agent_keys").select("id,name").in("id", agentKeyIds) : Promise.resolve({ data: [] }),
      agentRecordIds.length ? service.from("os_records").select("id,title,record_type,metadata").in("id", agentRecordIds) : Promise.resolve({ data: [] }),
    ]);
    let documents = documentLookup;
    if (documentIds.length && (documents.error?.code === "42703" || documents.error?.code === "PGRST204")) {
      const legacy = await service.from("os_documents").select("id,title,status,owner_id").in("id", documentIds);
      documents = { ...legacy, data: legacy.data?.map((document) => ({ ...document, parent_document_id: null })) ?? null } as typeof documents;
    }
    if (documents.error) throw new ApiError(400, "AUDIT_DOCUMENT_ACCESS_FAILED", "문서 변경 기록의 접근 권한을 확인하지 못했습니다.");
    const allowedDocuments = await readableKnowledgePages(actor, documents.data ?? []);
    const documentNames = new Map((documents.data ?? []).filter((document) => allowedDocuments.has(document.id)).map((document) => [document.id, document.title]));
    const profileNames = new Map((profiles.data ?? []).map((profile) => [profile.id, profile.display_name || profile.email || "구성원"]));
    const agentNames = new Map((agentKeys.data ?? []).map((key) => [key.id, key.name]));
    const agentRecordNames = new Map((agentRecords.data ?? []).map((record) => [record.id, record]));
    const records = (recordResult.data ?? []).map((event) => {
      const record = Array.isArray(event.os_records) ? event.os_records[0] : event.os_records;
      return ({
      id: `record:${event.id}`,
      subject_id: event.record_id,
      subject_type: auditSubjectType(record),
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
      .filter((event) => allowedDocuments.has(event.document_id) && !String(event.note ?? "").startsWith("MCP 에이전트 "))
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
    const versionEvents = (versionResult.data ?? []).filter((version) => allowedDocuments.has(version.document_id)).map((version) => ({
      id: `version:${version.document_id}:${version.version_no}`,
      subject_id: version.document_id,
      subject_type: "knowledge_document",
      title: documentNames.get(version.document_id) ?? "지식 문서",
      actor_id: version.author_id,
      actor_type: "user",
      actor_name: version.author_id ? profileNames.get(version.author_id) ?? "구성원" : "시스템",
      event_type: "updated", from_status: null, to_status: null,
      changed_fields: ["content_md"], note: `문서 v${version.version_no} 저장`, created_at: version.created_at,
    }));
    const agentEvents = (agentResult.data ?? []).filter((event) => !event.document_id || allowedDocuments.has(event.document_id)).map((event) => ({
      id: `agent:${event.id}`,
      subject_id: event.record_id || event.document_id,
      subject_type: event.record_id ? auditSubjectType(agentRecordNames.get(event.record_id)) : "knowledge_document",
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
    const securityEvents = (securityResult.data ?? []).map((event) => ({
      id: `security:${event.id}`,
      subject_id: event.target_user_id,
      subject_type: "account_security",
      title: `${profileNames.get(event.target_user_id) ?? "구성원"} 계정 보안`,
      actor_id: event.actor_id,
      actor_type: "user",
      actor_name: event.actor_id ? profileNames.get(event.actor_id) ?? "관리자" : "시스템",
      event_type: ({ "account.created": "account_created", "password.changed": "password_changed", "password.reset": "password_reset", "member.shared_account": "updated", "agent_key.issued_shared": "created", "agent_key.reissue_requested": "created" } as Record<string, string>)[event.action] ?? "updated",
      from_status: null,
      to_status: null,
      changed_fields: event.action === "member.shared_account" ? ["is_shared_account"] : event.action.startsWith("agent_key.") ? ["agent_key"] : ["password"],
      note: event.note ?? "",
      created_at: event.created_at,
    }));
    const merged = [...records, ...documentEvents, ...versionEvents, ...agentEvents, ...securityEvents]
      .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id))
      .filter(event => !cursor || event.created_at < cursor.at || (event.created_at === cursor.at && event.id < cursor.id));
    const events = merged.slice(0, limit);
    const last = events.at(-1);
    const nextCursor = merged.length > limit && last
      ? Buffer.from(JSON.stringify({ at: last.created_at, id: last.id })).toString("base64url")
      : null;
    return NextResponse.json({ events, nextCursor });
  } catch (error) { return apiErrorResponse(error); }
}
