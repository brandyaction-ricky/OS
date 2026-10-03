import type { KnowledgeDocument } from "./types";

export function knowledgePageDescendants(documents: KnowledgeDocument[], parentId: string) {
  const byParent = new Map<string, KnowledgeDocument[]>();
  for (const document of documents) {
    if (!document.parent_document_id) continue;
    byParent.set(document.parent_document_id, [...(byParent.get(document.parent_document_id) ?? []), document]);
  }
  const seen = new Set([parentId]);
  const descendants: KnowledgeDocument[] = [];
  const visit = (id: string) => {
    for (const child of byParent.get(id) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id); descendants.push(child); visit(child.id);
    }
  };
  visit(parentId);
  return descendants;
}

export function canReparentKnowledgePage(documents: KnowledgeDocument[], id: string, parentId: string | null) {
  return parentId === null || (id !== parentId && !knowledgePageDescendants(documents, id).some(document => document.id === parentId));
}
