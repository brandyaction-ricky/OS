import { OPENAI_ANSWER_MODEL } from "@/lib/config";
import { ApiError } from "@/lib/http";
import type { SearchResult } from "@/lib/types";

function extractOutputText(response: Record<string, unknown>) {
  const output = Array.isArray(response.output) ? response.output : [];
  return output
    .flatMap((item) => (item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : []))
    .filter((content) => content && typeof content === "object" && (content as { type?: string }).type === "output_text")
    .map((content) => String((content as { text?: string }).text ?? ""))
    .join("\n")
    .trim();
}

export async function answerFromKnowledge(question: string, results: SearchResult[]) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return formatEvidenceOnly(results);
  const evidence = results.slice(0, 8).map((result, index) =>
    `[근거 ${index + 1}] ${result.title} / ${result.heading}\n${result.text}\n출처: document=${result.documentId}, version=${result.citation.version ?? "current"}, chunk=${result.citation.chunkId ?? "document"}`,
  ).join("\n\n");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_ANSWER_MODEL,
        instructions: "당신은 브랜디액션 사내 지식 도우미입니다. 제공된 회사 지식만 근거로 한국어로 짧고 명확하게 답하세요. 근거가 부족하면 모른다고 말하세요. 답 끝에 사용한 근거 번호를 [근거 1] 형식으로 표시하세요.",
        input: `질문:\n${question}\n\n회사 지식:\n${evidence || "검색된 근거 없음"}`,
        max_output_tokens: 700,
      }),
      signal: controller.signal,
    });
    const body = await response.json();
    if (!response.ok) throw new ApiError(502, "ANSWER_PROVIDER_ERROR", "답변 생성에 실패했습니다.");
    return extractOutputText(body) || formatEvidenceOnly(results);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return formatEvidenceOnly(results);
    if (error instanceof ApiError) throw error;
    return formatEvidenceOnly(results);
  } finally { clearTimeout(timer); }
}

function formatEvidenceOnly(results: SearchResult[]) {
  if (!results.length) return "관련 회사 지식을 찾지 못했습니다. 질문의 핵심 단어를 바꿔 다시 물어봐 주세요.";
  const body = results.slice(0, 3).map((result, index) => `${index + 1}. ${result.title}\n${result.text.slice(0, 350)}`).join("\n\n");
  return `회사 지식에서 찾은 근거입니다.\n\n${body}`;
}
