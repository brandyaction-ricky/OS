import { z } from "zod";

const documentId = z.string().uuid();

export const MCP_TOOLS = [
  {
    name: "search_knowledge",
    description: "브랜디 OS 회사 정본과 이 AI 소유자의 초안에서 관련 근거를 검색합니다.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1 },
        top_k: { type: "integer", minimum: 1, maximum: 20 },
        include_my_drafts: { type: "boolean", default: true },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_document",
    description: "검색 결과나 쓰기 결과의 문서 원문과 현재 버전을 읽습니다.",
    inputSchema: {
      type: "object",
      properties: { document_id: { type: "string", format: "uuid" } },
      required: ["document_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "create_document",
    description: "새 지식을 개인 초안으로 만듭니다. 회사 정본으로 바로 만들 수 없습니다.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1 },
        content_md: { type: "string", minLength: 1 },
        folder: { type: "string", default: "AI 저장/검토 대기" },
        tags: { type: "array", items: { type: "string" } },
        reason: { type: "string" },
      },
      required: ["title", "content_md"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "edit_document",
    description: "문서를 수정하고 새 버전을 남깁니다. expected_version으로 동시 수정 충돌을 감지할 수 있습니다.",
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", format: "uuid" },
        expected_version: { type: "integer", minimum: 1 },
        title: { type: "string", minLength: 1 },
        content_md: { type: "string", minLength: 1 },
        folder: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        reason: { type: "string" },
      },
      required: ["document_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "delete_document",
    description: "문서를 영구 삭제하지 않고 OS 휴지통으로 옮깁니다. confirm=true가 반드시 필요합니다.",
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", format: "uuid" },
        confirm: { type: "boolean" },
        reason: { type: "string" },
      },
      required: ["document_id", "confirm"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
] as const;

const searchArgs = z.object({
  query: z.string().trim().min(1).max(2_000),
  top_k: z.number().int().min(1).max(20).optional().default(8),
  include_my_drafts: z.boolean().optional().default(true),
}).strict();

const getArgs = z.object({ document_id: documentId }).strict();

const createArgs = z.object({
  title: z.string().trim().min(1).max(200),
  content_md: z.string().min(1).max(1_500_000),
  folder: z.string().trim().max(160).optional().default("AI 저장/검토 대기"),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).optional().default([]),
  reason: z.string().trim().max(500).optional().default("원격 MCP 에이전트 생성"),
}).strict();

const editArgs = z.object({
  document_id: documentId,
  expected_version: z.number().int().positive().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  content_md: z.string().min(1).max(1_500_000).optional(),
  folder: z.string().trim().max(160).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  reason: z.string().trim().max(500).optional().default("원격 MCP 에이전트 수정"),
}).strict().refine((input) => [input.title, input.content_md, input.folder, input.tags].some((value) => value !== undefined), {
  message: "수정할 필드가 필요합니다.",
});

const deleteArgs = z.object({
  document_id: documentId,
  confirm: z.literal(true),
  reason: z.string().trim().max(500).optional().default("원격 MCP 에이전트 휴지통 이동"),
}).strict();

type ToolRequest = {
  name: string;
  arguments?: unknown;
};

type FetchApi = (path: string, init?: RequestInit) => Promise<unknown>;

export async function callMcpTool(request: ToolRequest, organizationId: string, fetchApi: FetchApi) {
  const args = request.arguments ?? {};
  if (request.name === "search_knowledge") {
    const input = searchArgs.parse(args);
    const statuses = ["canonical"];
    if (input.include_my_drafts) statuses.push("draft", "team", "review", "reviewed");
    return fetchApi("/api/v1/search", {
      method: "POST",
      body: JSON.stringify({
        organizationId,
        query: input.query,
        mode: "hybrid",
        topK: input.top_k,
        filters: { statuses },
      }),
    });
  }
  if (request.name === "get_document") {
    const input = getArgs.parse(args);
    const query = new URLSearchParams({ organizationId, documentId: input.document_id });
    return fetchApi(`/api/v1/knowledge-documents?${query}`);
  }
  if (request.name === "create_document") {
    const input = createArgs.parse(args);
    return fetchApi("/api/v1/knowledge-documents", {
      method: "POST",
      body: JSON.stringify({
        organizationId,
        title: input.title,
        contentMd: input.content_md,
        folder: input.folder,
        tags: input.tags,
        status: "personal_draft",
        reason: input.reason,
      }),
    });
  }
  if (request.name === "edit_document") {
    const input = editArgs.parse(args);
    return fetchApi("/api/v1/knowledge-documents", {
      method: "PATCH",
      body: JSON.stringify({
        organizationId,
        documentId: input.document_id,
        expectedVersion: input.expected_version,
        title: input.title,
        contentMd: input.content_md,
        folder: input.folder,
        tags: input.tags,
        reason: input.reason,
      }),
    });
  }
  if (request.name === "delete_document") {
    const input = deleteArgs.parse(args);
    const query = new URLSearchParams({ organizationId, documentId: input.document_id, reason: input.reason });
    return fetchApi(`/api/v1/knowledge-documents?${query}`, { method: "DELETE" });
  }
  throw new Error("알 수 없는 도구입니다.");
}
