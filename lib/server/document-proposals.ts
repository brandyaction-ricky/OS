import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { RequestActor } from "./auth";

export interface DocumentProposalInput {
  title: string;
  content_md: string;
  folder: string;
  brand: string;
  team: string;
  tags: string[];
}

/** Mirrors public.os_is_designated_approver: an active, explicitly assigned approver (no admin fallback). */
export async function isDesignatedApprover(userId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await createServiceSupabase().from("os_approval_assignments")
    .select("starts_on,ends_on").eq("user_id", userId).eq("kind", "approver").is("revoked_at", null);
  if (error) return false;
  return (data ?? []).some((row) => (!row.starts_on || row.starts_on <= today) && (!row.ends_on || row.ends_on >= today));
}

export async function createCanonicalProposal(actor: RequestActor, current: {
  id: string; current_version: number; status: string; owner_id?: string; steward_id?: string | null;
}, expectedVersion: number, next: DocumentProposalInput, note = "") {
  // 대표 11-28: an AI key's change to a document it did not write (a team document, one in 정본 요청, the owner's own note) is a
  // proposal too; the document's owner decides it on 정본 검토 and it is applied with their own edit right.
  const team = current.status !== "canonical";
  if (team && actor.type !== "agent") throw new ApiError(400, "CANONICAL_REQUIRED", "회사 정본만 변경 제안을 만듭니다.");
  if (current.current_version !== expectedVersion) throw new ApiError(409, "VERSION_CONFLICT", "문서가 먼저 변경됐습니다. 다시 열어 확인해 주세요.");
  const service=createServiceSupabase();
  let approver:string|null=team?current.owner_id??null:null;
  if(!team&&current.steward_id&&![actor.ownerId,current.owner_id].includes(current.steward_id)){
    const profile=await service.from("os_profiles").select("id,is_active,member_kind").eq("id",current.steward_id).maybeSingle();
    const authority=await service.rpc("os_can_approve",{p_actor:current.steward_id,p_author:actor.ownerId});
    if(!profile.error&&!authority.error&&profile.data?.is_active&&profile.data.member_kind==="staff"&&authority.data===true)approver=current.steward_id;
  }
  const { data, error } = await service.from("os_document_proposals").insert({
    document_id: current.id,
    base_version: expectedVersion,
    ...next,
    author_id: actor.ownerId,
    agent_key_id: actor.type === "agent" ? actor.id : null,
    status: "open",
    requested_approver_id: approver,
    ...(team ? { author_note: note } : { note }),
  }).select("id,document_id,base_version,title,content_md,folder,brand,team,tags,author_id,agent_key_id,status,created_at").single();
  if (error || !data) throw new ApiError(error?.code === "42P01" ? 503 : 400,
    error?.code === "42P01" ? "PROPOSAL_SETUP_PENDING" : "PROPOSAL_CREATE_FAILED",
    error?.code === "42P01" ? "개발 DB의 변경 제안 기능 적용이 필요합니다." : "변경 제안을 저장하지 못했습니다.");
  return data;
}

/**
 * 대표 11-28: an AI key's proposal on a document that is not company canon (see createCanonicalProposal). Its owner (or the named
 * approver, or an admin) decides it; an approval is saved with the decider's own edit right (document.commit checks it), so no one
 * gains a permission they did not have. Returns null for a canon proposal, which the database decides as before.
 */
export async function decideTeamProposal(actor: RequestActor, input: { id: string; decision?: unknown; reason?: unknown }) {
  const service = createServiceSupabase();
  const { data: prop } = await service.from("os_document_proposals")
    .select("id,document_id,base_version,title,content_md,author_id,requested_approver_id,status").eq("id", input.id).maybeSingle();
  if (!prop) return null;
  const { data: doc } = await service.from("os_documents").select("id,status,owner_id,current_version").eq("id", prop.document_id).maybeSingle();
  if (!doc || doc.status === "canonical") return null;
  if (prop.status !== "open") throw new ApiError(409, "PROPOSAL_NOT_OPEN", "이미 처리된 제안입니다.");
  const decision = String(input.decision ?? ""), reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 500) : "";
  const decided = { reviewer_id: actor.ownerId, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  let patch: Record<string, unknown>;
  if (decision === "withdrawn") {
    if (prop.author_id !== actor.ownerId) throw new ApiError(403, "PROPOSAL_DENIED", "제안한 사람만 취소할 수 있어요.");
    patch = { status: "withdrawn", ...decided };
  } else {
    if (actor.type !== "user" || ![doc.owner_id, prop.requested_approver_id].includes(actor.ownerId) && actor.role !== "admin")
      throw new ApiError(403, "PROPOSAL_DENIED", "문서 주인만 이 제안을 결정할 수 있어요.");
    if (decision === "approved") {
      if (doc.current_version !== prop.base_version) throw new ApiError(409, "VERSION_CONFLICT", "문서가 그사이 바뀌었어요. 이 제안은 닫고 최신 문서에서 다시 받아 주세요.");
      const { error } = await actor.supabase.rpc("os_knowledge_command", { p: { action: "document.commit", id: doc.id, expectedVersion: doc.current_version, title: prop.title, content: prop.content_md } });
      if (error) throw new ApiError(403, "PROPOSAL_APPLY_DENIED", "이 문서를 고칠 권한이 없어 반영하지 못했어요.", error.message);
      patch = { status: "approved", note: reason, ...decided };
    } else if ((decision === "returned" || decision === "rejected") && reason) {
      patch = { status: "returned", return_kind: decision === "rejected" ? "reject" : "revise", note: reason, ...decided };
    } else throw new ApiError(400, "DECISION_INVALID", "보완·반려 이유를 적어 주세요.");
  }
  const { error } = await service.from("os_document_proposals").update(patch).eq("id", prop.id).eq("status", "open");
  if (error) throw new ApiError(400, "PROPOSAL_DECIDE_FAILED", "검토 결과를 저장하지 못했습니다.");
  return { id: prop.id };
}
