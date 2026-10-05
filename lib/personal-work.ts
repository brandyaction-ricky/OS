import type { OsRecord } from "./record-types";
import type { KnowledgeDocument } from "./types";
import { contentOrigin } from "./content-origin.ts";
import { developmentStatusLabel, requestPlainSummary } from "./development-status.ts";
export type WorkTab = "received" | "review" | "requested";
export interface WorkItem { id: string; title: string; status: string; dueDate: string | null; href: string; kind: string; nextAction: string }
export function recordWorkHref(record: Pick<OsRecord, "id" | "record_type" | "metadata">) {
  const id = encodeURIComponent(record.id);
  if (record.metadata.kind === "development_request") return `/knowledge/development?request=${id}`;
  if (record.metadata.kind === "meta_tester_request") return `/settings/account?tester=${id}`;
  if (record.metadata.kind === "channel_expiry") return "/settings/account";
  if (record.metadata.kind === "agent_key_reissue_request") return "/settings/access";
  if (record.record_type === "content_publish") return `/content/publishing?tab=review&publication=${id}`;
  if (record.record_type === "task") return `/organization/tasks?task=${id}`;
  if (record.record_type === "meeting") return `/organization/meetings?meeting=${id}`;
  if (record.record_type === "decision") return `/organization/meetings?tab=decisions&record=${id}`;
  if (record.record_type === "leave_request") return "/organization/leave";
  if (record.record_type === "content_package" && record.metadata.packageKind === "appeal_candidates") return "/content/topics?tab=niches";
  if (record.record_type.startsWith("content_")) return `/content/publishing?sourceId=${encodeURIComponent(String(record.metadata.sourceId || record.id))}`;
  return `/organization/agents?job=${id}`;
}
const closed = new Set(["done", "completed", "cancelled", "published", "rejected"]);
export function buildPersonalWork(records: OsRecord[], documents: KnowledgeDocument[], userId: string, admin = false): Record<WorkTab, WorkItem[]> {
  const visible = records.filter(record => !record.archived_at && contentOrigin(record) === "own");
  const item = (record: OsRecord): WorkItem => ({ id: record.id, title: record.title,
    status: record.metadata.kind === "development_request" ? developmentStatusLabel(record.status) : ({ backlog: "대기", planned: "예정", active: "진행", review: "검토", ready: "승인 대기", blocked: "막힘", done: "완료" } as Record<string, string>)[record.status] || record.status,
    dueDate: record.due_date, href: recordWorkHref(record), kind: record.record_type,
    nextAction: record.metadata.kind === "development_request" ? requestPlainSummary(record).nextAction : String(record.metadata.nextAction || record.metadata.doneCriteria || "상세에서 다음 행동 확인"),
  });
  const pending = visible.filter(record => !closed.has(record.status));
  const review = pending.filter(record => record.assignee_id === userId && ["review", "ready", "approval", "pending_approval"].includes(record.status)).map(item);
  const reviewDocs = documents.filter(doc => ["review", "reviewed"].includes(doc.status) && (doc.status === "review" || doc.owner_id === userId || admin)).map(doc => ({
    id: doc.id, title: doc.title, status: doc.status === "review" ? "검토 요청" : "공개 확인", dueDate: null, href: `/knowledge/review?document=${encodeURIComponent(doc.id)}`, kind: "document", nextAction: doc.status === "review" ? "원문을 확인하고 검토 의견 남기기" : "검토 결과 확인 후 공개 여부 판단",
  }));
  return {
    received: pending.filter(record => record.assignee_id === userId && !["review", "ready", "approval", "pending_approval"].includes(record.status)).sort((a,b) => (a.due_date || "9999").localeCompare(b.due_date || "9999")).map(item),
    review: [...review, ...reviewDocs],
    requested: visible.filter(record => record.created_by === userId).sort((a,b) => b.updated_at.localeCompare(a.updated_at)).map(item),
  };
}
