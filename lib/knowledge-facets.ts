import type { KnowledgeDocument } from "./types";
export function knowledgeFacets(documents: Pick<KnowledgeDocument, "folder" | "team" | "brand" | "tags">[]) {
  const sorted = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a,b) => a.localeCompare(b,"ko"));
  return {folders: sorted(documents.map(row => row.folder || "분류 없음")), teams: sorted(documents.map(row => row.team)), brands: sorted(documents.map(row => row.brand)), tags: sorted(documents.flatMap(row => row.tags ?? []))};
}
