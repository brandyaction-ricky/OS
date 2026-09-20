import { z } from "zod";

export const KNOWLEDGE_ASSET_BUCKET = "os-knowledge-assets";
export const KNOWLEDGE_ASSET_MAX_BYTES = 15 * 1024 * 1024;
export const KNOWLEDGE_ASSET_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
} as const;

export const knowledgeAssetCreateSchema = z.object({
  documentId: z.string().uuid(),
  reference: z.string().trim().min(1).max(500),
  fileName: z.string().trim().min(1).max(240),
  fileSize: z.number().int().positive().max(KNOWLEDGE_ASSET_MAX_BYTES),
  mimeType: z.enum(Object.keys(KNOWLEDGE_ASSET_TYPES) as [keyof typeof KNOWLEDGE_ASSET_TYPES, ...(keyof typeof KNOWLEDGE_ASSET_TYPES)[]]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

export type KnowledgeAsset = {
  id: string;
  document_id: string;
  reference: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  storage_path: string;
  sha256: string | null;
  source_document: string | null;
  created_at: string;
  updated_at: string;
  url?: string;
};

export type MarkdownImageReference = { reference: string; alt: string; raw: string };

export function normalizeAssetReference(value: string) {
  const decoded = (() => { try { return decodeURIComponent(value); } catch { return value; } })();
  return decoded.replace(/^<|>$/g, "").replace(/\\/g, "/").replace(/^\.\//, "").split(/[?#]/)[0].trim().normalize("NFC");
}

export function assetReferenceKey(value: string) {
  return normalizeAssetReference(value).toLocaleLowerCase("ko-KR");
}

export function parseMarkdownImages(content: string): MarkdownImageReference[] {
  const found: MarkdownImageReference[] = [];
  const seen = new Set<string>();
  const add = (reference: string, alt: string, raw: string) => {
    const normalized = normalizeAssetReference(reference);
    if (!normalized || /^(https?:|data:)/i.test(normalized)) return;
    const key = assetReferenceKey(normalized);
    if (seen.has(key)) return;
    seen.add(key); found.push({ reference: normalized, alt: alt.trim(), raw });
  };
  for (const match of content.matchAll(/!\[\[([^\]]+)\]\]/g)) add(match[1].split("|")[0], match[1].split("|").slice(1).join("|"), match[0]);
  for (const match of content.matchAll(/!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\)/g)) add(match[2] || match[3], match[1], match[0]);
  return found;
}
