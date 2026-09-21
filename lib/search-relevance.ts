import type { SearchResult } from "./types";

const SEARCH_STOP_WORDS = new Set([
  "뭐", "뭐냐", "뭔가", "어떤", "어떤거", "어떤게", "알려줘", "알려", "보여줘", "보여",
  "찾아줘", "찾아", "있나", "있어", "있는지", "인가", "이야", "해줘", "대한", "관련",
  "the", "a", "an", "what", "which", "show", "find", "tell", "about",
]);

const GENERIC_KNOWLEDGE_TERMS = new Set([
  "자료", "문서", "지식", "회사", "내용", "현재", "기준", "콘텐츠", "운영",
]);

const KOREAN_QUESTION_ENDINGS = ["인가요", "일까요", "이야", "인가", "인지", "일까", "나요"];
const KOREAN_PARTICLES = ["에서", "으로", "에게", "한테", "이", "가", "은", "는", "을", "를", "의", "에", "도", "만", "로"];

function normalizedWords(value: string) {
  const normalized = value
    .replace(/@[A-Za-z0-9_]+/g, " ")
    .replace(/[%_,().?!/\\:;\[\]{}'\"`~@#$^&*+=|<>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return normalized.split(" ").filter((word) => word.length >= 2 && !SEARCH_STOP_WORDS.has(word)).map((word) => {
    if (!/^[가-힣]+$/.test(word)) return word;
    const ending = KOREAN_QUESTION_ENDINGS.find((candidate) => word.endsWith(candidate) && word.length > candidate.length);
    if (ending) return word.slice(0, -ending.length);
    const particle = KOREAN_PARTICLES.find((candidate) => word.endsWith(candidate) && word.length - candidate.length >= 2);
    return particle ? word.slice(0, -particle.length) : word;
  }).filter((word) => word && !SEARCH_STOP_WORDS.has(word));
}

export function searchTerms(value: string) {
  const words = normalizedWords(value).filter((word) => word.length >= 2);
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

export function keywordQueryText(value: string) {
  const words = [...new Set(normalizedWords(value))];
  const specific = words.filter((word) => !GENERIC_KNOWLEDGE_TERMS.has(word));
  const selected = specific.length >= 2 ? specific : words;
  return selected.slice(0, 8).join(" ") || value.trim();
}

function evidenceTerms(value: string) {
  const terms = searchTerms(value);
  const specific = terms.filter((term) => !GENERIC_KNOWLEDGE_TERMS.has(term));
  return specific.length ? specific : terms;
}

function searchableText(result: Pick<SearchResult, "title" | "heading" | "text">) {
  return `${result.title} ${result.heading} ${result.text}`.toLowerCase();
}

export function hasLexicalEvidence(result: Pick<SearchResult, "title" | "heading" | "text">, query: string) {
  const terms = evidenceTerms(query);
  if (!terms.length) return false;
  const searchable = searchableText(result);
  return terms.some((term) => searchable.includes(term));
}

export function rankLexicalEvidence<T extends Pick<SearchResult, "title" | "heading" | "text">>(results: T[], query: string) {
  const terms = evidenceTerms(query);
  if (!terms.length || results.length < 2) return results;
  const texts = results.map(searchableText);
  const frequencies = new Map(terms.map((term) => [term, Math.max(1, texts.filter((text) => text.includes(term)).length)]));
  return results.map((result, index) => ({
    result,
    index,
    score: terms.reduce((score, term, termIndex) => score + (texts[index].includes(term) ? (termIndex + 1) / (frequencies.get(term) ?? 1) : 0), 0),
  })).sort((left, right) => right.score - left.score || left.index - right.index).map(({ result }) => result);
}

export function evidenceQueryText(value: string) {
  const withoutLeadingLabel = value.replace(/^\s*\[[^\]\r\n]{1,80}\]\s*/u, "").trim();
  return withoutLeadingLabel || value.trim();
}
