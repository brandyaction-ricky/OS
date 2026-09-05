import { z } from "zod";
import type { OsRecord } from "./record-types";

export const DEVELOPMENT_REQUEST_STATUSES = ["backlog", "active", "review", "done", "blocked"] as const;
export const DEVELOPMENT_REQUEST_CATEGORIES = ["bug", "usability", "feature", "question"] as const;
export type DevelopmentRequestStatus = (typeof DEVELOPMENT_REQUEST_STATUSES)[number];

export function isSafeDevelopmentLink(value: string, allowPath = false) {
  if (!value) return true;
  if (/[\\\s]/.test(value)) return false;
  if (allowPath && /^\/(?!\/)/.test(value) && !/[\\\s]/.test(value)) return true;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

const link = (allowPath = false) => z.string().trim().max(2_000).refine((value) => isSafeDevelopmentLink(value, allowPath), "http(s) 주소를 입력해 주세요.");
const details = {
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(20_000),
  parentId: z.string().uuid().nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  pageUrl: link(true),
  category: z.enum(DEVELOPMENT_REQUEST_CATEGORIES),
  steps: z.string().trim().max(8_000),
  expectedResult: z.string().trim().max(8_000),
  attachmentUrl: link(),
};

export const developmentRequestCreateSchema = z.object({
  title: details.title,
  description: details.description.default(""),
  parentId: details.parentId.optional().default(null),
  priority: details.priority.default("normal"),
  pageUrl: details.pageUrl.default(""),
  category: details.category.default("bug"),
  steps: details.steps.default(""),
  expectedResult: details.expectedResult.default(""),
  attachmentUrl: details.attachmentUrl.default(""),
}).strict();

export const developmentRequestUpdateSchema = z.object({
  ...Object.fromEntries(Object.entries(details).map(([key, value]) => [key, value.optional()])) as { [K in keyof typeof details]: z.ZodOptional<(typeof details)[K]> },
  id: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  status: z.enum(DEVELOPMENT_REQUEST_STATUSES).optional(),
  resolution: z.string().trim().max(12_000).optional(),
  branch: z.string().trim().max(300).optional(),
  commitSha: z.string().trim().max(64).refine((value) => !value || /^[a-f0-9]{7,64}$/i.test(value), "커밋 SHA를 확인해 주세요.").optional(),
  prUrl: link().optional(),
  deploymentUrl: link().optional(),
}).strict().refine((value) => Object.keys(value).some((key) => !["id", "expectedVersion"].includes(key)), "수정할 항목이 필요합니다.");

export type DevelopmentRequestUpdate = z.infer<typeof developmentRequestUpdateSchema>;
export function isDevelopmentRequest(record: Pick<OsRecord, "record_type" | "metadata"> | null | undefined) {
  return record?.record_type === "ai_job" && record.metadata?.kind === "development_request";
}

export class DevelopmentRequestPolicyError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 403) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const MANAGEMENT_FIELDS = ["resolution", "branch", "commitSha", "prUrl", "deploymentUrl"] as const;

export function validateDevelopmentRequestUpdate(
  current: Pick<OsRecord, "created_by" | "status" | "metadata">,
  input: DevelopmentRequestUpdate,
  actor: { id: string; role: string },
) {
  if (actor.role !== "admin") {
    if (current.created_by !== actor.id) throw new DevelopmentRequestPolicyError("REQUEST_OWNER_REQUIRED", "본인이 등록한 요청만 수정할 수 있습니다.");
    if (MANAGEMENT_FIELDS.some((key) => input[key] !== undefined)) throw new DevelopmentRequestPolicyError("REQUEST_ADMIN_REQUIRED", "처리 결과와 코드 정보는 관리자만 기록할 수 있습니다.");
    const keys = Object.keys(input).filter((key) => !["id", "expectedVersion"].includes(key));
    const reopening = ["done", "review"].includes(current.status) && input.status === "backlog" && keys.every((key) => key === "status");
    const editingBacklog = current.status === "backlog" && (input.status === undefined || input.status === "backlog");
    if (!reopening && !editingBacklog) throw new DevelopmentRequestPolicyError("REQUEST_STATUS_FORBIDDEN", "접수 대기 요청을 수정하거나 검수·완료 요청을 다시 열 수 있습니다.");
  }
  const status = input.status ?? current.status;
  const resolution = input.resolution ?? current.metadata.resolution;
  if (status === "done" && (typeof resolution !== "string" || !resolution.trim())) {
    throw new DevelopmentRequestPolicyError("REQUEST_RESOLUTION_REQUIRED", "완료 전에 처리 결과를 기록해 주세요.", 400);
  }
}

export function developmentRequestMetadata(input: z.infer<typeof developmentRequestCreateSchema>) {
  return { kind: "development_request", pageUrl: input.pageUrl, category: input.category, steps: input.steps, expectedResult: input.expectedResult, attachmentUrl: input.attachmentUrl };
}

export function developmentRequestUpdateFields(current: OsRecord, input: DevelopmentRequestUpdate) {
  const metadata: Record<string, unknown> = { ...current.metadata, kind: "development_request" };
  for (const field of ["pageUrl", "category", "steps", "expectedResult", "attachmentUrl", ...MANAGEMENT_FIELDS] as const) {
    if (input[field] !== undefined) metadata[field] = input[field];
  }
  const output: Record<string, unknown> = { metadata };
  for (const field of ["title", "description", "priority", "status"] as const) if (input[field] !== undefined) output[field] = input[field];
  if (input.parentId !== undefined) output.parent_id = input.parentId;
  return output;
}
