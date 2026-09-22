import type { KnowledgeDocument } from "./types";

export type FolderInventory = Array<{ path: string; count: number }>;
export interface KnowledgeDraft { title: string; content: string; folder: string; brand: string; team: string; tags: string }
export function documentDraft(document: KnowledgeDocument): KnowledgeDraft {
  return { title: document.title, content: document.content_md, folder: document.folder, brand: document.brand, team: document.team, tags: document.tags.join(", ") };
}
export function draftChanged(draft: KnowledgeDraft, baseline: KnowledgeDraft) {
  return (Object.keys(baseline) as Array<keyof KnowledgeDraft>).some(key => draft[key] !== baseline[key]);
}
export function inKnowledgeScope(document: KnowledgeDocument, scope: string, ownerId?: string) {
  if (scope === "archived") return document.status === "archived";
  if (document.status === "archived") return false;
  if (scope === "mine_company") return document.owner_id === ownerId || document.status === "canonical";
  if (scope === "mine") return document.owner_id === ownerId;
  if (scope === "canonical" || scope === "team") return document.status === scope;
  if (scope === "review") return ["review", "reviewed"].includes(document.status);
  return !scope.startsWith("member:") || document.owner_id === scope.slice(7);
}
// Counts describe all documents in the scope, including folders not loaded yet.
export function updateFolderInventory(inventory: FolderInventory, before: KnowledgeDocument | undefined, after: KnowledgeDocument, scope: string, ownerId?: string): FolderInventory {
  const counts = new Map(inventory.map(item => [item.path, item.count]));
  if (before && inKnowledgeScope(before, scope, ownerId)) {
    const path = before.folder || "분류 없음";
    counts.set(path, Math.max(0, (counts.get(path) ?? 0) - 1));
  }
  if (inKnowledgeScope(after, scope, ownerId)) {
    const path = after.folder || "분류 없음";
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return [...counts].filter(([, count]) => count > 0).map(([path, count]) => ({ path, count }));
}
