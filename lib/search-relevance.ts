import type { SearchResult } from "./types";

const SEARCH_STOP_WORDS = new Set([
  "뭐", "뭐냐", "뭔가", "어떤", "어떤거", "어떤게", "알려줘", "알려", "보여줘", "보여",
  "찾아줘", "찾아", "있나", "있어", "있는지", "인가", "이야", "해줘", "대한", "관련",
  "the", "a", "an", "what", "which", "show", "find", "tell", "about",
]);

export function searchTerms(value: string) {
  const normalized = value
    .replace(/@[A-Za-z0-9_]+/g, " ")
    .replace(/[%_,().?!/\\:;\[\]{}'\"`~@#$^&*+=|<>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const words = normalized.split(" ").filter((word) => word.length >= 2 && !SEARCH_STOP_WORDS.has(word));
  const terms = new Set<string>();
  for (const word of words) {
    terms.add(word);
    if (/^[가-힣]{4,}$/.test(word)) {
      for (let index = 0; index < word.length - 1; index += 2) terms.add(word.slice(index, index + 2));
      terms.add(word.slice(-2));
    }
  }
  return [...terms].filter((term) => term.length >= 2).slice(0, 8);
}

export function hasLexicalEvidence(result: Pick<SearchResult, "title" | "heading" | "text">, query: string) {
  const terms = searchTerms(query);
  if (!terms.length) return false;
  const searchable = `${result.title} ${result.heading} ${result.text}`.toLowerCase();
  return terms.some((term) => searchable.includes(term));
}

export function evidenceQueryText(value: string) {
  const withoutLeadingLabel = value.replace(/^\s*\[[^\]\r\n]{1,80}\]\s*/u, "").trim();
  return withoutLeadingLabel || value.trim();
}
