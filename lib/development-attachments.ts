import { z } from "zod";

export const DEVELOPMENT_ATTACHMENT_BUCKET = "os-development-attachments";
export const DEVELOPMENT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

export const DEVELOPMENT_ATTACHMENT_TYPES = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
  "application/pdf": "pdf", "text/plain": "txt", "text/markdown": "txt", "text/csv": "csv",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/zip": "zip",
} as const;

export function developmentAttachmentStorageType(mimeType: keyof typeof DEVELOPMENT_ATTACHMENT_TYPES) {
  return mimeType === "text/markdown" ? "text/plain" : mimeType;
}

export function developmentAttachmentUploadBody(file: Blob, contentType: string) {
  return file.type === contentType ? file : file.slice(0, file.size, contentType);
}

export const developmentAttachmentCreateSchema = z.object({
  fileName: z.string().trim().min(1).max(240),
  fileSize: z.number().int().positive().max(DEVELOPMENT_ATTACHMENT_MAX_BYTES),
  mimeType: z.enum(Object.keys(DEVELOPMENT_ATTACHMENT_TYPES) as [keyof typeof DEVELOPMENT_ATTACHMENT_TYPES, ...(keyof typeof DEVELOPMENT_ATTACHMENT_TYPES)[]]),
}).strict();

export const developmentAttachmentPathSchema = z.string().regex(
  /^requests\/[0-9a-f-]{36}\/[0-9]{4}-[0-9]{2}-[0-9]{2}\/[0-9a-f-]{36}\.(jpg|png|webp|gif|mp4|mov|webm|pdf|txt|csv|doc|docx|ppt|pptx|xls|xlsx|zip)$/,
);

export const developmentAttachmentDownloadNameSchema = z.string().trim().min(1).max(240).refine(
  (value) => !/[\\/\0\r\n]/.test(value),
  "내려받을 파일 이름을 확인해 주세요.",
);

export type DevelopmentAttachment = {
  path: string;
  name: string;
  size: number;
  type: string;
};
