import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { authenticateRequest, requireAgentScope } from "@/lib/server/auth";
import { indexDocument } from "@/lib/server/indexing";
import { assertOrganization } from "@/lib/server/organization";
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

function writeError(error: { message?: string } | null, fallbackCode: string, fallbackMessage: string) {
  const detail = error?.message ?? "";
  if (detail.includes("OS_VERSION_CONFLICT")) return new ApiError(409, "VERSION_CONFLICT", "다른 작업이 먼저 문서를 수정했습니다. 최신 버전으로 다시 시도해 주세요.");
  if (detail.includes("OS_AGENT_RATE_LIMITED")) return new ApiError(429, "AGENT_RATE_LIMITED", "AI 쓰기 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.");
  if (detail.includes("OS_AGENT_DOCUMENT_DENIED") || detail.includes("OS_AGENT_WRITE_DENIED")) return new ApiError(403, "AGENT_WRITE_DENIED", "이 문서를 변경할 권한이 없습니다.");
  if (detail.includes("OS_AGENT_ARCHIVED_READ_ONLY")) return new ApiError(409, "DOCUMENT_ARCHIVED", "휴지통 문서는 수정할 수 없습니다.");
  if (detail.includes("OS_DOC_NOT_FOUND")) return new ApiError(404, "DOCUMENT_NOT_FOUND", "문서를 찾을 수 없습니다.");
  return new ApiError(400, fallbackCode, fallbackMessage, detail || undefined);
}

async function enqueueIndex(documentId: string) {
  try {
    return await indexDocument(documentId);
  } catch (error) {
    console.error("agent knowledge indexing failed", error);
    return "queued" as const;
  }
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request, { allowAgent: true, requiredAgentScope: "knowledge.read" });
    const url = new URL(request.url);
    const parsedOrganizationId = organizationId.parse(url.searchParams.get("organizationId"));
    const documentId = z.string().uuid().parse(url.searchParams.get("documentId"));
    await assertOrganization(actor, parsedOrganizationId);
    const { data, error } = await createServiceSupabase().from("os_documents").select("*").eq("id", documentId).single();
    if (error || !data) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "문서를 찾을 수 없습니다.");
    if (actor.type === "agent") {
      const ownsDocument = data.owner_id === actor.ownerId;
      if (!actor.allowedStatuses.includes(data.status) || (data.status !== "canonical" && !ownsDocument)) {
        throw new ApiError(403, "DOCUMENT_FORBIDDEN", "이 문서를 열 수 없습니다.");
      }
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
    const indexing = await enqueueIndex(document.id);
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

    if (actor.type === "agent") {
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
      if (error || !document) throw writeError(error, "DOCUMENT_UPDATE_FAILED", "문서를 수정하지 못했습니다.");
    }
    const indexing = input.contentMd === undefined ? "queued" : await enqueueIndex(document.id);
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
      const { data, error } = await createServiceSupabase().rpc("os_agent_archive_document", {
        p_agent_key_id: actor.id,
        p_organization_id: parsedOrganizationId,
        p_document_id: documentId,
        p_reason: reason,
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
