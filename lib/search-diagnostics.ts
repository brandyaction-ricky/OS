export type SearchDegradation = "embeddings_unconfigured" | "embedding_timeout" | "embedding_failed" | "search_timeout" | "search_failed" | "supplement_failed";
export const SEARCH_DEGRADATION_MESSAGES: Record<SearchDegradation, string> = {
  supplement_failed: "추가 문서 검색을 완료하지 못했습니다. 응답한 검색 결과만 표시합니다.",
  embeddings_unconfigured: "의미 검색이 연결되지 않아 단어 검색 결과를 표시합니다.",
  embedding_timeout: "의미 검색 준비 시간이 초과되어 단어 검색 결과를 표시합니다.",
  embedding_failed: "의미 검색 서비스가 응답하지 않아 단어 검색 결과를 표시합니다.",
  search_timeout: "검색 엔진의 응답 시간이 초과되어 문서에서 직접 찾은 결과를 표시합니다.",
  search_failed: "검색 엔진 오류로 문서에서 직접 찾은 결과를 표시합니다.",
};
export function matchingExcerpt(content: string, terms: string[], size = 700) {
  const lower = content.toLocaleLowerCase("ko-KR");
  const positions = terms.map(term => lower.indexOf(term.toLocaleLowerCase("ko-KR"))).filter(position => position >= 0);
  const hit = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, hit - 140);
  const prefix = content.slice(0, hit);
  const headings = [...prefix.matchAll(/^#{1,6}\s+(.+)$/gm)];
  return { text: (start ? "…" : "") + content.slice(start, start + size) + (start + size < content.length ? "…" : ""), heading: headings.at(-1)?.[1] || "본문" };
}
