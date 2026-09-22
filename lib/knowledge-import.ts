import type { KnowledgeDocument } from "./types";

export const IMPORT_FILE_LIMIT = 50;
export const IMPORT_BYTE_LIMIT = 1_500_000;
export type ImportCandidate = Pick<KnowledgeDocument, "id" | "title" | "folder" | "status" | "current_version" | "source_ref"> & { sameContent: boolean; canUpdate: boolean };
export type ImportProbe = { id: string; path: string; title: string; hash: string };
export function normalizeImportPath(path: string) {
  const normalized = path.replace(/\\/g, "/").normalize("NFC").replace(/^\.\//, "");
  if (!normalized || normalized.length > 400 || normalized.startsWith("/") || normalized.split("/").some(part => !part || part === ".." || part === ".") || /[\x00-\x1f]/.test(normalized)) throw new Error("원본 파일 경로를 확인해 주세요. 상대 경로 400자까지 지원합니다.");
  return normalized;
}
export function importTitle(path: string, content: string) { return (content.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.split("/").at(-1)!.replace(/\.md$/i, "")).slice(0, 200); }
export function normalizedImportContent(content: string) { return content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim(); }
export async function importContentHash(content: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizedImportContent(content)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function defaultImportAction(hash: string, candidates: ImportCandidate[], seen: Set<string>): "skip" | "create" {
  return seen.has(hash) || candidates.some(candidate => candidate.sameContent) ? "skip" : "create";
}

export async function executeImports<T extends {id: string; action: string; done?: boolean}, R>(items: T[], write: (item: T) => Promise<R>, onResult: (item: T, result: {value: R} | {error: string}) => void) {
  for (const item of items) {
    if (item.done || item.action === "skip") continue;
    try { onResult(item, {value: await write(item)}); }
    catch (reason) { onResult(item, {error: reason instanceof Error ? reason.message : "저장하지 못했습니다. 다시 시도해 주세요."}); }
  }
}
