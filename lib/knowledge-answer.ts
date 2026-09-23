import type { SearchResult } from "./types";

type AnswerSource = Pick<SearchResult, "documentId" | "title" | "heading">;

const EVIDENCE_MARKER = /\[근거\s*(\d+)\]/gu;

function compact(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trimEnd()}…` : normalized;
}

function sourceLabel(result: AnswerSource) {
  const title = compact(result.title || "제목 없는 문서", 80);
  const heading = compact(result.heading || "", 100);
  return !heading || heading === "본문" || heading === title ? title : `${title} › ${heading}`;
}

function referencedSources(answer: string, results: AnswerSource[], maxSources: number) {
  const referenced = [...answer.matchAll(EVIDENCE_MARKER)]
    .map((match) => Number(match[1]) - 1)
    .filter((index) => Number.isInteger(index) && index >= 0 && index < results.length);
  const indexes = referenced.length ? referenced : results.map((_, index) => index);
  const seen = new Set<string>();
  const sources: AnswerSource[] = [];
  for (const index of indexes) {
    const result = results[index];
    if (!result) continue;
    const key = `${result.documentId}\u0000${result.heading}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(result);
    if (sources.length >= maxSources) break;
  }
  return sources;
}

export function formatKnowledgeAnswer(answer: string, results: AnswerSource[], publicUrl: string, maxSources = 3) {
  const body = answer
    .replace(EVIDENCE_MARKER, "")
    .replace(/[ \t]+([,.!?。])/gu, "$1")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  const sources = referencedSources(answer, results, maxSources);
  if (!sources.length) return body;
  const baseUrl = publicUrl.replace(/\/$/u, "");
  const sourceLines = sources.map((result, index) =>
    `${index + 1}. ${sourceLabel(result)}\n${baseUrl}/knowledge?document=${encodeURIComponent(result.documentId)}`,
  );
  return `${body}\n\n근거 문서\n${sourceLines.join("\n\n")}`;
}
