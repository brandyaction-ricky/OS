import { z } from "zod";
import { KNOWLEDGE_ATTACHMENT_TYPES, knowledgeAttachmentPathSchema } from "./knowledge-attachments.ts";

export const KNOWLEDGE_ASSET_IMAGE_TYPES = Object.fromEntries(
  Object.entries(KNOWLEDGE_ATTACHMENT_TYPES).filter(([mimeType]) => mimeType.startsWith("image/")),
) as Record<string, string>;

export const knowledgeAssetReferenceSchema = z.string().trim().min(1).max(1_000);
export const knowledgeAssetSha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);

const knowledgeAssetBaseSchema = z.object({
  documentId: z.string().uuid(),
  reference: knowledgeAssetReferenceSchema,
  fileName: z.string().trim().min(1).max(240),
  fileSize: z.number().int().positive().max(100 * 1024 * 1024),
  mimeType: z.string().refine((value) => value in KNOWLEDGE_ASSET_IMAGE_TYPES, "지원하지 않는 이미지 형식입니다."),
  sha256: knowledgeAssetSha256Schema,
  sourceDocument: z.string().trim().max(500).optional().default(""),
  fileCreatedAt: z.string().datetime().optional().nullable(),
}).strict();

export const knowledgeAssetPrepareSchema = knowledgeAssetBaseSchema;
export const knowledgeAssetFinalizeSchema = knowledgeAssetBaseSchema.extend({
  path: knowledgeAttachmentPathSchema,
}).strict();

export interface KnowledgeAsset {
  id: string;
  documentId: string;
  reference: string;
  referenceKey: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  storagePath: string;
  sha256: string | null;
  sourceDocument: string;
  fileCreatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  url: string;
  expiresIn: number;
  nativeAttachment?: boolean;
}

export interface MissingKnowledgeAssetReference {
  documentId: string;
  documentTitle: string;
  documentFolder: string;
  sourceDocument: string;
  reference: string;
  referenceKey: string;
  fileName: string;
}

export interface KnowledgeAssetRecoveryCandidate {
  id: string;
  name: string;
  path: string;
}

export function knowledgeAssetRecoveryCandidates<T extends KnowledgeAssetRecoveryCandidate>(
  reference: Pick<MissingKnowledgeAssetReference, "reference" | "referenceKey" | "fileName">,
  candidates: T[],
) {
  const exact = candidates.filter((candidate) => reference.referenceKey === candidate.path
    || reference.referenceKey.endsWith(`/${candidate.path}`)
    || candidate.path.endsWith(`/${reference.referenceKey}`));
  if (exact.length) return exact;
  const expectedName = normalizeKnowledgeAssetReference(knowledgeAssetFileName(reference.reference));
  return candidates.filter((candidate) => candidate.name === expectedName);
}

export function normalizeKnowledgeAssetReference(raw: string) {
  let value = raw.trim().replace(/^<|>$/g, "").replace(/\\/g, "/");
  try { value = decodeURIComponent(value); } catch { /* Keep the original path when it is not URI encoded. */ }
  value = value.split("|")[0].split("#")[0].replace(/^file:\/\//i, "").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
  return value.normalize("NFC").toLocaleLowerCase("ko-KR");
}

export function knowledgeAssetFileName(reference: string) {
  const normalized = reference.trim().replace(/\\/g, "/").split("|")[0].split("#")[0];
  return normalized.split("/").filter(Boolean).pop() || normalized || "이미지";
}

export function knowledgeAssetReferences(content: string) {
  const references: Array<{ reference: string; referenceKey: string; fileName: string }> = [];
  const seen = new Set<string>();
  const add = (reference: string) => {
    if (/^(?:https?:|data:|knowledge-attachment:)/i.test(reference)) return;
    const referenceKey = normalizeKnowledgeAssetReference(reference);
    if (!referenceKey || seen.has(referenceKey)) return;
    seen.add(referenceKey);
    references.push({ reference, referenceKey, fileName: knowledgeAssetFileName(reference) });
  };
  for (const match of content.matchAll(/!\[\[([^\]]+)\]\]/g)) add(match[1].split("|")[0]);
  for (const match of content.matchAll(/!\[[^\]]*\]\((<[^>]+>|(?:[^\s()]+|\([^()]*\))+)(?:\s+"[^"]*")?\)/g)) add(match[1].replace(/^<|>$/g, ""));
  return references;
}

export function knowledgeAssetRow(row: Record<string, unknown>, url = ""): KnowledgeAsset {
  return {
    id: String(row.id),
    documentId: String(row.document_id),
    reference: String(row.reference),
    referenceKey: String(row.reference_key),
    fileName: String(row.file_name),
    fileSize: Number(row.file_size),
    mimeType: String(row.mime_type),
    storagePath: String(row.storage_path),
    sha256: row.sha256 ? String(row.sha256) : null,
    sourceDocument: row.source_document ? String(row.source_document) : "",
    fileCreatedAt: row.file_created_at ? String(row.file_created_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    url,
    expiresIn: 900,
  };
}
