import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { authenticateRequest, requireAgentScope } from "@/lib/server/auth";
import { canReadKnowledgeDocument, canAgentWriteDocument, canAgentEditDraft } from "@/lib/server/document-access";
import { readableKnowledgePages } from "@/lib/server/knowledge-page-access";
import { assertOrganization } from "@/lib/server/organization";
import { createCanonicalProposal, isDesignatedApprover } from "@/lib/server/document-proposals";
import type { KnowledgeDocument } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const organizationId = z.string().uuid();
const createSchema = z.object({
  organizationId,
  title: z.string().trim().min(1).max(200),
  contentMd: z.string().min(1).max(1_500_000),
  folder: z.string().trim().max(160).optional().default("AI 저장/검토 대기"),
  brand: z.string().trim().max(120).optional().default(""),
  team: z.string().trim().max(120).optional().default(""),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).optional().default([]),
  status: z.enum(["personal_draft", "draft"]).optional().default("personal_draft"),
  reason: z.string().trim().max(500).optional().default("MCP 에이전트 생성"),
});
const updateSchema = z.object({
  organizationId,
  documentId: z.string().uuid(),
  expectedVersion: z.number().int().positive().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  contentMd: z.string().min(1).max(1_500_000).optional(),
  folder: z.string().trim().max(160).optional(),
  brand: z.string().trim().max(120).optional(),
  team: z.string().trim().max(120).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  reason: z.string().trim().max(500).optional().default("MCP 에이전트 수정"),
}).refine((input) => [input.title, input.contentMd, input.folder, input.brand, input.team, input.tags].some((value) => value !== undefined), {
  message: "수정할 필드가 필요합니다.",
});

function rpcRow<T>(data: T | T[] | null): T | null {
  return Array.isArray(data) ? data[0] ?? null : data;
}

type RateLimitDetails = {
  bucket: string;
  minuteLimit: number;
  minuteUsed: number;
  dayLimit: number;
  dayUsed: number;
  retryAfterSeconds: number;
  resetAt: string;
};

function rateLimitDetails(detail: string): RateLimitDetails | null {
  const marker = "OS_AGENT_RATE_LIMITED:";
  const start = detail.indexOf(marker);
  if (start < 0) return null;
  try {
    const parsed = JSON.parse(detail.slice(start + marker.length)) as Partial<RateLimitDetails>;
    if (!parsed.bucket || !parsed.resetAt) return null;
    return {
      bucket: parsed.bucket,
      minuteLimit: Number(parsed.minuteLimit),
      minuteUsed: Number(parsed.minuteUsed),
      dayLimit: Number(parsed.dayLimit),
      dayUsed: Number(parsed.dayUsed),
      retryAfterSeconds: Math.max(1, Number(parsed.retryAfterSeconds)),
      resetAt: parsed.resetAt,
    };
  } catch {
    return null;
  }
}

function writeError(error: { message?: string } | null, fallbackCode: string, fallbackMessage: string) {
  const detail = error?.message ?? "";
  if (detail.includes("OS_VERSION_CONFLICT")) return new ApiError(409, "VERSION_CONFLICT", "다른 작업이 먼저 문서를 수정했습니다. 최신 버전으로 다시 시도해 주세요.");
  if (detail.includes("OS_AGENT_RATE_LIMITED")) {
    const limits = rateLimitDetails(detail);
    const retryAfterSeconds = limits?.retryAfterSeconds ?? 60;
    const message = limits
      ? `AI 쓰기 요청 한도를 초과했습니다. ${retryAfterSeconds}초 후 다시 시도해 주세요.`
      : "AI 쓰기 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.";
    return new ApiError(429, "AGENT_RATE_LIMITED", message, limits ?? { retryAfterSeconds }, {
      "Retry-After": String(retryAfterSeconds),
    });
  }
  if (detail.includes("OS_AGENT_DOCUMENT_DENIED") || detail.includes("OS_AGENT_WRITE_DENIED")) return new ApiError(403, "AGENT_WRITE_DENIED", "이 문서를 변경할 권한이 없습니다.");
  if (detail.includes("OS_AGENT_ARCHIVED_READ_ONLY")) return new ApiError(409, "DOCUMENT_ARCHIVED", "휴지통 문서는 수정할 수 없습니다.");
  if (detail.includes("OS_DOC_NOT_FOUND")) return new ApiError(404, "DOCUMENT_NOT_FOUND", "문서를 찾을 수 없습니다.");
  if (detail.includes("OS_STATUS_TRANSITION_DENIED") || detail.includes("OS_OPEN_CANDIDATE")) return new ApiError(403, "AGENT_WRITE_DENIED", "이 키 주인의 권한으로는 이 문서를 휴지통으로 옮길 수 없습니다.");
  return new ApiError(400, fallbackCode, fallbackMessage, detail || undefined);
}

// The document trigger queued the index job; the night runner (/api/v1/indexing/night) indexes it.
const INDEXING = "queued" as const;

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request, { allowAgent: true, requiredAgentScope: "knowledge.read" });
    const url = new URL(request.url);
    const parsedOrganizationId = organizationId.parse(url.searchParams.get("organizationId"));
    const documentId = z.string().uuid().parse(url.searchParams.get("documentId"));
    await assertOrganization(actor, parsedOrganizationId);
    const { data, error } = await createServiceSupabase().from("os_documents").select("*").eq("id", documentId).single();
    if (error || !data) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "문서를 찾을 수 없습니다.");
    if (!canReadKnowledgeDocument(actor, data) || !(await readableKnowledgePages(actor, [data])).has(data.id)) {
      throw new ApiError(403, "DOCUMENT_FORBIDDEN", "이 문서를 열 수 없습니다.");
    }
    return NextResponse.json({ document: data });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_DOCUMENT_QUERY", "조직 ID와 문서 ID를 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request, { allowAgent: true, requiredAgentScope: "knowledge.write" });
    requireAgentScope(actor, "knowledge.write");
    const input = createSchema.parse(await parseJson(request));
    await assertOrganization(actor, input.organizationId);
    if (!canAgentWriteDocument(actor, "draft")) throw new ApiError(403, "DOCUMENT_STATUS_FORBIDDEN", "이 키로 초안을 만들 수 없습니다.");
    let document: KnowledgeDocument | null = null;

    if (actor.type === "agent") {
      const { data, error } = await createServiceSupabase().rpc("os_agent_create_document", {
        p_agent_key_id: actor.id,
        p_organization_id: input.organizationId,
        p_title: input.title,
        p_content_md: input.contentMd,
        p_folder: input.folder,
        p_brand: input.brand,
        p_team: input.team,
        p_tags: input.tags,
        p_reason: input.reason,
      });
      document = rpcRow(data) as KnowledgeDocument | null;
      if (error || !document) throw writeError(error, "DOCUMENT_CREATE_FAILED", "문서를 저장하지 못했습니다.");
    } else {
      const { data, error } = await actor.supabase.from("os_documents").insert({
        title: input.title,
        content_md: input.contentMd,
        folder: input.folder,
        brand: input.brand,
        team: input.team || actor.team,
        tags: input.tags,
        source: "mcp",
        status: "draft",
        owner_id: actor.id,
        created_by: actor.id,
      }).select("*").single();
      if (error || !data) throw new ApiError(400, "DOCUMENT_CREATE_FAILED", "문서를 저장하지 못했습니다.", error?.message);
      document = data as KnowledgeDocument;
    }
    const indexing = INDEXING;
    return NextResponse.json({ documentId: document.id, document, indexing }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_DOCUMENT", "문서 내용을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await authenticateRequest(request, { allowAgent: true, requiredAgentScope: "knowledge.write" });
    requireAgentScope(actor, "knowledge.write");
    const input = updateSchema.parse(await parseJson(request));
    await assertOrganization(actor, input.organizationId);
    const service = createServiceSupabase();
    const { data: current, error: readError } = await service.from("os_documents").select("*").eq("id", input.documentId).single();
    if (readError || !current) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "문서를 찾을 수 없습니다.");
    if (!canAgentWriteDocument(actor, current.status)) throw new ApiError(403, "DOCUMENT_STATUS_FORBIDDEN", "이 키로 변경할 수 없는 문서 상태입니다.");
    const expectedVersion = input.expectedVersion ?? current.current_version;
    const next = {
      title: input.title ?? current.title,
      content: input.contentMd ?? current.content_md,
      folder: input.folder ?? current.folder,
      brand: input.brand ?? current.brand,
      team: input.team ?? current.team,
      tags: input.tags ?? current.tags,
    };
    const changedFields = ([
      ["title", input.title], ["content_md", input.contentMd], ["folder", input.folder],
      ["brand", input.brand], ["team", input.team], ["tags", input.tags],
    ] as const).filter(([, value]) => value !== undefined).map(([field]) => field);
    let document: KnowledgeDocument | null = null;

    if (current.status === "canonical") {
      if (!canReadKnowledgeDocument(actor, current) || !(await readableKnowledgePages(actor, [current])).has(current.id)) {
        throw new ApiError(403, "DOCUMENT_FORBIDDEN", "이 정본에 변경 제안을 만들 수 없습니다.");
      }
      const proposal = await createCanonicalProposal(actor, current, expectedVersion, {
        title: next.title,
        content_md: next.content,
        folder: next.folder,
        brand: next.brand ?? "",
        team: next.team,
        tags: next.tags,
      });
      // The designated approver's own AI key applies its proposal at once, recorded as approved by that owner.
      if (actor.type === "agent" && await isDesignatedApprover(actor.ownerId)) {
        const { data, error } = await service.rpc("os_agent_apply_own_proposal", {
          p_agent_key_id: actor.id, p_organization_id: input.organizationId, p_proposal_id: proposal.id,
        });
        const applied = rpcRow(data) as KnowledgeDocument | null;
        if (!error && applied) {
          return NextResponse.json({ documentId: applied.id, document: applied, proposalId: proposal.id, applied: true, indexing: INDEXING });
        }
        console.error("owner-key canonical apply failed; proposal left open", error?.message);
      }
      return NextResponse.json({ documentId: current.id, document: current, proposalId: proposal.id, proposal, indexing: "queued" }, { status: 202 });
    }

    if (actor.type === "agent") {
      if(!canAgentEditDraft(actor,current)) throw new ApiError(403,"AGENT_WRITE_DENIED","AI 키는 자신이 만든 AI 초안만 직접 수정할 수 있습니다. 정본은 변경 제안으로 검토합니다.");
      const { data, error } = await service.rpc("os_agent_update_document", {
        p_agent_key_id: actor.id,
        p_organization_id: input.organizationId,
        p_document_id: input.documentId,
        p_expected_version: expectedVersion,
        p_title: next.title,
        p_content_md: next.content,
        p_folder: next.folder,
        p_brand: next.brand,
        p_team: next.team,
        p_tags: next.tags,
        p_changed_fields: changedFields,
        p_reason: input.reason,
      });
      document = rpcRow(data) as KnowledgeDocument | null;
      if (error?.message?.includes("OS_ATTACHMENT_EXPIRED")) {
        throw new ApiError(409, "KNOWLEDGE_ATTACHMENT_EXPIRED", "첨부 자료의 보관 시간이 지나 저장하지 못했습니다. 해당 자료를 다시 첨부해 주세요.");
      }
      if (error || !document) throw writeError(error, "DOCUMENT_UPDATE_FAILED", "문서를 수정하지 못했습니다.");
    } else {
      const { data, error } = await actor.supabase.rpc("os_update_document", {
        p_document_id: input.documentId,
        p_expected_version: expectedVersion,
        p_title: next.title,
        p_content_md: next.content,
        p_folder: next.folder,
        p_brand: next.brand,
        p_team: next.team,
        p_tags: next.tags,
        p_reason: input.reason,
      });
      document = rpcRow(data) as KnowledgeDocument | null;
      if (error?.message?.includes("OS_ATTACHMENT_EXPIRED")) {
        throw new ApiError(409, "KNOWLEDGE_ATTACHMENT_EXPIRED", "첨부 자료의 보관 시간이 지나 저장하지 못했습니다. 해당 자료를 다시 첨부해 주세요.");
      }
      if (error || !document) throw writeError(error, "DOCUMENT_UPDATE_FAILED", "문서를 수정하지 못했습니다.");
    }
    const indexing = INDEXING;
    return NextResponse.json({ documentId: document.id, document, indexing });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_DOCUMENT", "수정 내용을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await authenticateRequest(request, { allowAgent: true, requiredAgentScope: "knowledge.write" });
    requireAgentScope(actor, "knowledge.write");
    const url = new URL(request.url);
    const parsedOrganizationId = organizationId.parse(url.searchParams.get("organizationId"));
    const documentId = z.string().uuid().parse(url.searchParams.get("documentId"));
    const reason = z.string().trim().max(500).parse(url.searchParams.get("reason") ?? "MCP 에이전트 휴지통 이동");
    await assertOrganization(actor, parsedOrganizationId);
    let document: KnowledgeDocument | null = null;

    if (actor.type === "agent") {
      // Same rule as the key owner pressing 휴지통 themselves.
      const { data, error } = await createServiceSupabase().rpc("os_agent_trash_document", {
        p_agent_key_id: actor.id, p_organization_id: parsedOrganizationId, p_document_id: documentId, p_reason: reason,
      });
      document = rpcRow(data) as KnowledgeDocument | null;
      if (error || !document) throw writeError(error, "DOCUMENT_ARCHIVE_FAILED", "문서를 휴지통으로 옮기지 못했습니다.");
    } else {
      const { data, error } = await actor.supabase.rpc("os_set_document_status", {
        p_document_id: documentId,
        p_to: "archived",
        p_note: reason,
      });
      document = rpcRow(data) as KnowledgeDocument | null;
      if (error || !document) throw writeError(error, "DOCUMENT_ARCHIVE_FAILED", "문서를 휴지통으로 옮기지 못했습니다.");
    }
    return NextResponse.json({ deleted: true, permanent: false, documentId, document });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_DOCUMENT_QUERY", "조직 ID와 문서 ID를 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
