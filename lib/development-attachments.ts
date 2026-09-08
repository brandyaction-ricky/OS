import { z } from "zod";

export const DEVELOPMENT_ATTACHMENT_BUCKET = "os-development-attachments";
export const DEVELOPMENT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

export const DEVELOPMENT_ATTACHMENT_TYPES = {
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

export const developmentAttachmentCreateSchema = z.object({
  fileName: z.string().trim().min(1).max(240),
  fileSize: z.number().int().positive().max(DEVELOPMENT_ATTACHMENT_MAX_BYTES),
  mimeType: z.enum(Object.keys(DEVELOPMENT_ATTACHMENT_TYPES) as [keyof typeof DEVELOPMENT_ATTACHMENT_TYPES, ...(keyof typeof DEVELOPMENT_ATTACHMENT_TYPES)[]]),
}).strict();

export const developmentAttachmentPathSchema = z.string().regex(
  /^requests\/[0-9a-f-]{36}\/[0-9]{4}-[0-9]{2}-[0-9]{2}\/[0-9a-f-]{36}\.(jpg|png|webp|gif|mp4|mov|webm|pdf|txt|csv|doc|docx|ppt|pptx|xls|xlsx|zip)$/,
);

export type DevelopmentAttachment = {
  path: string;
  name: string;
  size: number;
  type: string;
};

