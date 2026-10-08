import type { KnowledgeDocument, DocumentVersion, DocumentProposal } from "../types";
import type { KnowledgeActor } from "./access";

export const CATEGORY_COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
export type Space = "mine" | "team" | "canon" | "meet" | "ai";
export interface Category { id: string; space: "mine" | "team"; owner_id: string | null; name: string; color: string; sort_order: number; partner_ids: string[]; archived_at?: string | null }
export interface Template { default_key?: string | null; id: string; name: string; description: string; body_md: string; default_space: "mine" | "team" | "meeting"; kind: "doc" | "meeting" | "candidate"; scope: "company" | "personal"; owner_id: string | null; sort_order: number; archived_at?: string | null }
export interface InboxNote { id: string; owner_id: string; body: string; created_at: string; processed_at?: string | null; processed_document_id?: string | null }
export interface Draft { document_id: string; user_id: string; title: string; content_md: string; base_version: number; updated_at: string }
export interface Person { id: string; display_name: string; role: string; member_kind: "staff" | "partner"; can_approve: boolean }
export interface MeetingItem { id: string; kind: "decision" | "task"; text: string; state: "pending" | "accepted" | "discarded"; ownerId?: string; dueOn?: string; source?: "manual" | "ai"; addedBy?: string; legacyConfirmed?: boolean; confirmedBy?: string; confirmedAt?: string; reviewMissing?: boolean; correctionReason?: string }
export interface Meeting { id: string; legacy?: boolean; title: string; description: string; status: "planned" | "active" | "review" | "done"; version: number; owner_id: string; created_by: string; starts_at: string | null; attendees: string[]; metadata: { workspace: "knowledge"; visibility: "team" | "attendees"; agenda: string; items: MeetingItem[]; summary?: string; reviewedBy?: string; reviewedAt?: string; previousMeetingId?: string; corrections?: Array<{ text: string; reason: string; at: string; by: string }> }; updated_at: string }
export interface Candidate { id: string; document_id: string; requested_approver_id: string; target_folder: string; steward_id: string | null; review_due_on: string; submitted_by: string; submitted_at: string; status: "open" | "approved" | "returned" | "withdrawn"; decision_note?: string }
export interface Proposal extends DocumentProposal { comments?:Array<{id:string;line_no:number;body:string;created_at:string}>; requested_approver_id?: string | null; author_note?: string; return_kind?: "revise" | "reject"; proxy_reason?: string; review_due_on?: string | null; ai_assist?: string; agent_owner_id?: string | null }
export interface KnowledgeEvent { id: string; actor_id: string; action: string; target_type: string; target_id: string; detail: Record<string, unknown>; created_at: string }
export interface KnowledgeState {
  documents: KnowledgeDocument[]; categories: Category[]; templates: Template[]; inbox: InboxNote[]; pins: string[];
  drafts: Draft[]; versions: Record<string, DocumentVersion[]>; meetings: Meeting[]; candidates: Candidate[];
  proposals: Proposal[]; people: Person[]; events: KnowledgeEvent[];
}
export interface WorkspaceSnapshot { state: KnowledgeState; actor: KnowledgeActor; schemaReady: boolean }
export type Command = { action: string; id?: string; expectedVersion?: number; [key: string]: unknown };
export const SPACE_LABELS: Record<Space, string> = { mine: "내 노트", team: "팀 문서", canon: "회사 정본", meet: "회의록", ai: "AI 작업 기록" };
export const WORK_LABELS = { todo: "할 일", doing: "진행 중", done: "완료" };
export function documentSpace(doc: KnowledgeDocument): Space {
  if (doc.meeting_record_id) return "meet";
  const status = doc.status === "archived" ? doc.archived_from_status : doc.status;
  return status === "canonical" ? "canon" : doc.source === "mcp" ? "ai" : !status || status === "draft" ? "mine" : "team";
}
export function documentHref(doc: KnowledgeDocument) {
  return doc.meeting_record_id ? `/knowledge/meetings/${doc.meeting_record_id}` : `/knowledge/${doc.status === "canonical" ? "canon" : "doc"}/${doc.id}`;
}
export function kstDay(date = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
export function kstTime(date: string) {
  const parts=new Intl.DateTimeFormat("en-GB", {timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(date));
  const value=(type:string)=>parts.find(part=>part.type===type)?.value??"";
  return `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")} KST`;
}
export function daysLeft(doc: KnowledgeDocument, now = new Date()) {
  if (!doc.archived_at) return null;
  return Math.max(0, 30 - Math.floor((Date.parse(kstDay(now)) - Date.parse(kstDay(new Date(doc.archived_at)))) / 86400000));
}
export function emptyKnowledgeState(): KnowledgeState { return { documents: [], categories: [], templates: [], inbox: [], pins: [], drafts: [], versions: {}, meetings: [], candidates: [], proposals: [], people: [], events: [] }; }
export function documentPage<T>(rows:T[], requested:string|null, size=50) {
  const totalPages=Math.max(1,Math.ceil(rows.length/size));
  const parsed=Number(requested);
  const page=Number.isSafeInteger(parsed)?Math.max(1,Math.min(parsed,totalPages)):1;
  const start=(page-1)*size;
  return {page,totalPages,start,rows:rows.slice(start,start+size)};
}
