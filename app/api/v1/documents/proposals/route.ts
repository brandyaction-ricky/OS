import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { canReadKnowledgeDocument } from "@/lib/server/document-access";
import { readableKnowledgePages } from "@/lib/server/knowledge-page-access";
import { indexDocument } from "@/lib/server/indexing";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { DocumentProposal, KnowledgeDocument } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), proposalId: z.string().uuid(), note: z.string().trim().max(500).optional().default("") }),
  z.object({ action: z.literal("return"), proposalId: z.string().uuid(), note: z.string().trim().min(1).max(500) }),
  z.object({ action: z.literal("withdraw"), proposalId: z.string().uuid() }),
  z.object({ action: z.literal("comment"), proposalId: z.string().uuid(), lineNo: z.number().int().positive(), body: z.string().trim().min(1).max(2000) }),
]);

function proposalError(error: { code?: string; message?: string } | null) {
  if (error?.message?.includes("OS_PROPOSAL_VERSION_CONFLICT")) return new ApiError(409, "PROPOSAL_VERSION_CONFLICT", "정본이 그새 바뀌었습니다. 현재 문서와 제안을 다시 비교해 주세요.");
  if (error?.message?.includes("OS_PROPOSAL_APPROVAL_DENIED")) return new ApiError(403, "PROPOSAL_APPROVAL_DENIED", "작성자와 다른 승인자 또는 유효한 위임자만 반영할 수 있습니다.");
  if (error?.message?.includes("OS_PROPOSAL_NOT_OPEN")) return new ApiError(409, "PROPOSAL_NOT_OPEN", "이미 처리된 변경 제안입니다.");
  if (error?.code === "42P01" || error?.code === "42883") return new ApiError(503, "PROPOSAL_SETUP_PENDING", "개발 DB의 변경 제안 기능 적용이 필요합니다.");
  return new ApiError(400, "PROPOSAL_FAILED", "변경 제안을 처리하지 못했습니다.", error?.message);
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const service = createServiceSupabase();
    let query = service.from("os_document_proposals").select("*").order("created_at", { ascending: false }).limit(100);
    if (id) query = query.eq("id", z.string().uuid().parse(id));
    else query = query.eq("status", "open");
    const { data, error } = await query;
    if (error) throw proposalError(error);
    const proposals = (data ?? []) as DocumentProposal[];
    const ids = [...new Set(proposals.map((proposal) => proposal.document_id))];
    if (!ids.length) return NextResponse.json({ proposals: [], documents: [], comments: [] });
    const { data: documentRows, error: documentError } = await actor.supabase.from("os_documents").select("*").in("id", ids);
    if (documentError) throw new ApiError(400, "PROPOSAL_DOCUMENTS_FAILED", "정본을 불러오지 못했습니다.");
    const documents = (documentRows ?? []) as KnowledgeDocument[];
    const allowedPages = await readableKnowledgePages(actor, documents);
    const visibleDocuments = documents.filter((document) => canReadKnowledgeDocument(actor, document) && allowedPages.has(document.id));
    const allowedIds = new Set(visibleDocuments.map((document) => document.id));
    const visibleProposals = proposals.filter((proposal) => allowedIds.has(proposal.document_id));
    if (id && !visibleProposals.length) throw new ApiError(404, "PROPOSAL_NOT_FOUND", "변경 제안을 열 수 없습니다.");
    const { data: comments, error: commentError } = id
      ? await service.from("os_document_proposal_comments").select("*").eq("proposal_id", id).order("created_at")
      : { data: [], error: null };
    if (commentError) throw proposalError(commentError);
    let incomingLinks: number | null = null;
    if (id && visibleProposals.length) {
      const { data: links, error: linkError } = await actor.supabase.from("os_document_links")
        .select("from_id").eq("to_id", visibleProposals[0].document_id);
      if (!linkError) {
        const sourceIds = [...new Set((links ?? []).map((link) => link.from_id))];
        if (!sourceIds.length) incomingLinks = 0;
        else {
          const { data: sources, error: sourceError } = await actor.supabase.from("os_documents")
            .select("id,owner_id,status,parent_document_id").in("id", sourceIds);
          if (!sourceError) {
            const allowedSources = await readableKnowledgePages(actor, sources ?? []);
            incomingLinks = (sources ?? []).filter((source) => allowedSources.has(source.id)).length;
          }
        }
      }
    }
    return NextResponse.json({ proposals: visibleProposals, documents: visibleDocuments, comments: comments ?? [], incomingLinks });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_PROPOSAL", "제안 ID를 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = actionSchema.parse(await parseJson(request));
    const service = createServiceSupabase();
    const { data: proposal, error } = await service.from("os_document_proposals").select("*").eq("id", input.proposalId).maybeSingle();
    if (error) throw proposalError(error);
    if (!proposal) throw new ApiError(404, "PROPOSAL_NOT_FOUND", "변경 제안을 찾을 수 없습니다.");
    const { data: document } = await actor.supabase.from("os_documents").select("*").eq("id", proposal.document_id).maybeSingle();
    if (!document || !canReadKnowledgeDocument(actor, document) || !(await readableKnowledgePages(actor, [document])).has(document.id)) {
      throw new ApiError(404, "PROPOSAL_NOT_FOUND", "변경 제안을 열 수 없습니다.");
    }
    if (input.action === "comment") {
      const lines = proposal.content_md.split("\n").length;
      if (input.lineNo > lines) throw new ApiError(400, "PROPOSAL_LINE_INVALID", "댓글을 달 줄을 다시 선택해 주세요.");
      const { data, error: commentError } = await service.from("os_document_proposal_comments")
        .insert({ proposal_id: proposal.id, line_no: input.lineNo, body: input.body, author_id: actor.id })
        .select("*").single();
      if (commentError || !data) throw proposalError(commentError);
      return NextResponse.json({ comment: data }, { status: 201 });
    }
    if (proposal.status !== "open") throw new ApiError(409, "PROPOSAL_NOT_OPEN", "이미 처리된 변경 제안입니다.");
    if (input.action === "withdraw") {
      if (proposal.author_id !== actor.id) throw new ApiError(403, "PROPOSAL_WITHDRAW_DENIED", "제안 작성자만 철회할 수 있습니다.");
    } else {
      const { data: authorAllowed, error: approvalError } = await actor.supabase.rpc("os_can_approve", { p_actor: actor.id, p_author: proposal.author_id });
      const { data: ownerAllowed, error: ownerError } = await actor.supabase.rpc("os_can_approve", { p_actor: actor.id, p_author: document.owner_id });
      if (approvalError || ownerError || !authorAllowed || !ownerAllowed) throw new ApiError(403, "PROPOSAL_APPROVAL_DENIED", "작성자와 다른 승인자 또는 유효한 위임자만 결정할 수 있습니다.");
    }
    if (input.action === "approve") {
      const { data, error: applyError } = await actor.supabase.rpc("os_apply_document_proposal", { p_proposal_id: proposal.id, p_note: input.note });
      if (applyError || !data) throw proposalError(applyError);
      try { await indexDocument(document.id); } catch (indexError) { console.error("proposal indexing failed", indexError); }
      return NextResponse.json({ proposal: { ...proposal, status: "approved", reviewer_id: actor.id }, document: data });
    }
    const status = input.action === "return" ? "returned" : "withdrawn";
    const { data, error: updateError } = await service.from("os_document_proposals")
      .update({ status, reviewer_id: input.action === "return" ? actor.id : null,
        decided_at: new Date().toISOString(), note: input.action === "return" ? input.note : "", updated_at: new Date().toISOString() })
      .eq("id", proposal.id).eq("status", "open").select("*").maybeSingle();
    if (updateError) throw proposalError(updateError);
    if (!data) throw new ApiError(409, "PROPOSAL_NOT_OPEN", "이미 처리된 변경 제안입니다.");
    return NextResponse.json({ proposal: data });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_PROPOSAL", "제안 내용을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
