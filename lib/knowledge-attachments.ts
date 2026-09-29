import { z } from "zod";

export const KNOWLEDGE_ATTACHMENT_BUCKET = "os-knowledge-attachments";
export const KNOWLEDGE_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;

export const KNOWLEDGE_ATTACHMENT_TYPES = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
  "application/pdf": "pdf", "text/plain": "txt", "text/csv": "csv",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/zip": "zip",
} as const;

export const knowledgeAttachmentCreateSchema = z.object({
  documentId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(240),
  fileSize: z.number().int().positive().max(KNOWLEDGE_ATTACHMENT_MAX_BYTES),
  mimeType: z.enum(Object.keys(KNOWLEDGE_ATTACHMENT_TYPES) as [keyof typeof KNOWLEDGE_ATTACHMENT_TYPES, ...(keyof typeof KNOWLEDGE_ATTACHMENT_TYPES)[]]),
}).strict();

export const knowledgeAttachmentPathSchema = z.string().regex(
  /^documents\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9]{4}-[0-9]{2}-[0-9]{2}\/[0-9a-f-]{36}\.(jpg|png|webp|gif|mp4|mov|webm|pdf|txt|csv|doc|docx|ppt|pptx|xls|xlsx|zip)$/,
);

export interface KnowledgeAttachmentReference {
  path: string;
  name: string;
  type: string;
  size?: number;
}

export function knowledgeAttachmentDocumentId(path: string) {
  return path.split("/")[1] ?? "";
}

export function knowledgeAttachmentUploaderId(path: string) {
  return path.split("/")[2] ?? "";
}

export function knowledgeAttachmentTarget(reference: KnowledgeAttachmentReference) {
  const params = new URLSearchParams({ path: reference.path, name: reference.name, type: reference.type });
  if (reference.size) params.set("size", String(reference.size));
  return `knowledge-attachment:?${params.toString()}`;
}

export function parseKnowledgeAttachmentTarget(target: string): KnowledgeAttachmentReference | null {
  if (!target.startsWith("knowledge-attachment:?")) return null;
  const params = new URLSearchParams(target.slice("knowledge-attachment:?".length));
  const path = params.get("path") ?? "";
  const name = params.get("name") ?? "";
  const type = params.get("type") ?? "";
  const size = Number(params.get("size") ?? 0);
  if (!knowledgeAttachmentPathSchema.safeParse(path).success || !name || name.length > 240 || !(type in KNOWLEDGE_ATTACHMENT_TYPES)) return null;
  return { path, name, type, ...(Number.isFinite(size) && size > 0 ? { size } : {}) };
}

export function knowledgeAttachmentMarkdown(reference: KnowledgeAttachmentReference) {
  const target = knowledgeAttachmentTarget(reference);
  const safeName = reference.name.replace(/[\[\]\r\n]/g, " ").trim() || "첨부 파일";
  return reference.type.startsWith("image/") ? `![${safeName}](${target})` : `[${safeName}](${target})`;
}
