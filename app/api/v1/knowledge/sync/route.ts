import { canAgentWriteDocument, canAgentEditDraft } from "@/lib/server/document-access";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest, requireAgentScope } from "@/lib/server/auth";
import { indexDocument } from "@/lib/server/indexing";
import { createServiceSupabase } from "@/lib/supabase/server";
import { createCanonicalProposal } from "@/lib/server/document-proposals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const pathSchema = z.string().trim().min(1).max(500).refine((value) => !value.startsWith("/") && !value.includes("..") && !/[\\\r\n]/.test(value), "상대 경로만 사용할 수 있습니다.");
const inputSchema = z.object({
  documents: z.array(z.object({
    sourceRef: pathSchema,
    title: z.string().trim().min(1).max(240),
    content: z.string().max(500_000),
    folder: z.string().trim().max(500).default(""),
    status: z.enum(["draft", "canonical"]).default("draft"),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  })).min(1).max(100),
});

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request, { allowAgent: true, requiredAgentScope: "knowledge.write" });
    requireAgentScope(actor, "knowledge.write");
    const input = inputSchema.parse(await parseJson(request, 50_000_000));
    if (actor.type === "user" && actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자 또는 지식 쓰기 에이전트만 볼트를 동기화할 수 있습니다.");
    if (input.documents.some((document) => (!canAgentWriteDocument(actor, document.status) || !actor.allowedStatuses.includes(document.status)))) throw new ApiError(403, "DOCUMENT_STATUS_FORBIDDEN", "이 키로 저장할 수 없는 문서 공개 범위가 포함돼 있습니다.");
    const service = createServiceSupabase();
    const refs = input.documents.map((document) => document.sourceRef.normalize("NFC"));
    const { data: existing, error: readError } = await service.from("os_documents").select("id,source_ref,title,folder,content_hash,current_version,status,owner_id").eq("source", "obsidian_vault").in("source_ref", refs);
    if (readError) throw new ApiError(400, "VAULT_SYNC_READ_FAILED", "기존 볼트 문서를 확인하지 못했습니다.", readError.message);
    if (actor.type === "agent" && (existing ?? []).some(document => !canAgentWriteDocument(actor, document.status))) throw new ApiError(403, "DOCUMENT_STATUS_FORBIDDEN", "이 키로 기존 문서를 변경할 수 없습니다.");
    if(actor.type === "agent" && (existing??[]).some(document=>document.status!=="canonical"&&!canAgentEditDraft(actor,{...document,source:"obsidian_vault"}))) throw new ApiError(403,"AGENT_WRITE_DENIED","AI 키는 자신의 볼트 초안 또는 정본 변경 제안만 동기화할 수 있습니다.");
    const byRef = new Map((existing ?? []).map((document) => [document.source_ref, document]));
    const counts = { created: 0, updated: 0, proposed: 0, unchanged: 0, indexed: 0, queued: 0 };
    for (const incoming of input.documents) {
      const sourceRef = incoming.sourceRef.normalize("NFC");
      const folder = sourceRef.split("/").slice(0, -1).join("/");
      const contentHash = createHash("sha256").update(incoming.content).digest("hex");
      if (incoming.contentHash && incoming.contentHash !== contentHash) throw new ApiError(400, "VAULT_HASH_MISMATCH", `${sourceRef} 내용 해시가 일치하지 않습니다.`);
      const current = byRef.get(sourceRef);
      let documentId = current?.id as string | undefined;
      const storedHash = createHash("md5").update(incoming.content).digest("hex");
      if (current?.content_hash === storedHash && current.title === incoming.title && current.folder === folder && current.status === incoming.status) { counts.unchanged += 1; continue; }
      if (current?.status === "canonical") {
        if (incoming.status !== "canonical") throw new ApiError(409, "CANONICAL_STATUS_CHANGE_FORBIDDEN", "정본 공개 범위 변경은 볼트 동기화로 처리할 수 없습니다.");
        await createCanonicalProposal(actor, current, current.current_version, {
          title: incoming.title, content_md: incoming.content, folder, brand: "", team: actor.team, tags: ["obsidian"],
        });
        counts.proposed += 1;
        continue;
      }
      if (!current && incoming.status === "canonical") {
        throw new ApiError(409, "CANONICAL_CREATE_REVIEW_REQUIRED", "새 정본은 초안으로 만든 뒤 검토·승인을 요청해 주세요.");
      }
      if (current) {
        const { data, error } = actor.type === "agent" ? await service.rpc("os_agent_update_document", {
          p_agent_key_id: actor.id, p_organization_id: actor.organizationId, p_document_id: current.id, p_expected_version: current.current_version,
          p_title: incoming.title, p_content_md: incoming.content, p_folder: folder, p_brand: "", p_team: actor.team, p_tags: ["obsidian"],
          p_changed_fields: ["title", "content_md", "folder", "tags"], p_reason: "볼트 변경 동기화",
        }) : await service.rpc("os_update_document", { p_document_id: current.id, p_expected_version: current.current_version, p_title: incoming.title, p_content_md: incoming.content, p_folder: folder, p_brand: "", p_team: actor.team, p_tags: ["obsidian"], p_reason: "볼트 변경 자동 동기화" });
        if (error || !data) throw new ApiError(409, "VAULT_SYNC_UPDATE_FAILED", `${sourceRef} 문서를 갱신하지 못했습니다.`, error?.message);
        if (current.status !== incoming.status) {
          const { error: statusError } = await service.from("os_documents").update({ status: incoming.status }).eq("id", current.id);
          if (statusError) throw new ApiError(400, "VAULT_SYNC_STATUS_FAILED", `${sourceRef} 공개 범위를 갱신하지 못했습니다.`, statusError.message);
        }
        documentId = data.id; counts.updated += 1;
      } else {
        const { data, error } = await service.from("os_documents").insert({ title: incoming.title, content_md: incoming.content, folder, status: incoming.status, source: "obsidian_vault", source_ref: sourceRef, owner_id: actor.ownerId, created_by: actor.ownerId, brand: "", team: actor.team, tags: ["obsidian"] }).select("id").single();
        if (error || !data) throw new ApiError(400, "VAULT_SYNC_CREATE_FAILED", `${sourceRef} 문서를 추가하지 못했습니다.`, error?.message);
        documentId = data.id; counts.created += 1;
      }
      if (documentId) {
        try {
          if ((await indexDocument(documentId)) === "ready") counts.indexed += 1;
          else counts.queued += 1;
        }
        catch { counts.queued += 1; }
      }
    }
    return NextResponse.json({ ok: true, counts });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_VAULT_CHANGESET", "볼트 변경 목록을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
