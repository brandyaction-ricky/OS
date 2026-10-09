import type { KnowledgeDocument } from "../types";

// Production workspace cutover. This is a read projection, not a status or ACL
// migration: imported drafts keep their owner, ID, body, history and visibility.
export const LEGACY_KNOWLEDGE_CUTOVER = "2026-10-09T03:45:00.000Z";
export function isLegacyTeamDocument(doc: Pick<KnowledgeDocument, "created_at" | "status" | "meeting_record_id">) {
  const created = Date.parse(doc.created_at);
  return Number.isFinite(created) && created < Date.parse(LEGACY_KNOWLEDGE_CUTOVER)
    && !doc.meeting_record_id && ["draft", "team", "review", "reviewed"].includes(doc.status);
}

/** Only pass documents already authorized by the server or demo access policy. */
export function legacyFolders(documents: Pick<KnowledgeDocument, "folder">[]) {
  const counts = new Map<string, number>();
  for (const doc of documents) {
    for (const part of doc.folder.matchAll(/[^/]+/g)) {
      const path = doc.folder.slice(0, part.index + part[0].length);
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }
  return [...counts].map(([path, count]) => ({ path, count })).sort((a, b) => a.path.localeCompare(b.path, "ko"));
}

export function inKnowledgeFolder(doc: Pick<KnowledgeDocument, "folder">, folder: string) {
  return !folder || doc.folder === folder || doc.folder.startsWith(folder + "/");
}
