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

export async function createCanonicalProposal(actor: RequestActor, current: {
  id: string; current_version: number; status: string;
}, expectedVersion: number, next: DocumentProposalInput, note = "") {
  if (current.status !== "canonical") throw new ApiError(400, "CANONICAL_REQUIRED", "회사 정본만 변경 제안을 만듭니다.");
  if (current.current_version !== expectedVersion) throw new ApiError(409, "VERSION_CONFLICT", "정본이 먼저 변경됐습니다. 다시 열어 확인해 주세요.");
  const { data, error } = await createServiceSupabase().from("os_document_proposals").insert({
    document_id: current.id,
    base_version: expectedVersion,
    ...next,
    author_id: actor.ownerId,
    agent_key_id: actor.type === "agent" ? actor.id : null,
    status: "open",
    note,
  }).select("id,document_id,base_version,title,content_md,folder,brand,team,tags,author_id,agent_key_id,status,created_at").single();
  if (error || !data) throw new ApiError(error?.code === "42P01" ? 503 : 400,
    error?.code === "42P01" ? "PROPOSAL_SETUP_PENDING" : "PROPOSAL_CREATE_FAILED",
    error?.code === "42P01" ? "개발 DB의 변경 제안 기능 적용이 필요합니다." : "변경 제안을 저장하지 못했습니다.");
  return data;
}
