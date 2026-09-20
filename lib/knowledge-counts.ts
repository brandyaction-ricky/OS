export type KnowledgeCountDefinition = {
  population: "all" | "visible_scope";
  archived: "included" | "excluded" | "only";
  content: "documents";
  label: string;
};

export function knowledgeCountDefinition(scope?: string | null): KnowledgeCountDefinition {
  if (!scope || scope === "all") return { population: "all", archived: "included", content: "documents", label: "전체 문서 · 보관 포함" };
  if (scope === "archived") return { population: "visible_scope", archived: "only", content: "documents", label: "휴지통 문서만" };
  const scopeLabel = scope === "mine_company" ? "내 문서 + 회사 정본" : scope === "mine" ? "내 문서" : scope === "canonical" ? "회사 정본" : scope === "team" ? "팀 공유" : scope === "review" ? "검토 문서" : "선택한 소유자";
  return { population: "visible_scope", archived: "excluded", content: "documents", label: `${scopeLabel} · 보관 제외` };
}

export const KNOWLEDGE_GRAPH_COUNT_DEFINITION: KnowledgeCountDefinition = {
  population: "all", archived: "excluded", content: "documents", label: "전체 문서 · 보관 제외 · 연결 유무 무관",
};
