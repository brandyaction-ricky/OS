import { OPENAI_ANSWER_MODEL } from "@/lib/config";
import { ApiError } from "@/lib/http";
import { formatKnowledgeAnswer } from "@/lib/knowledge-answer";
import type { SearchResult } from "@/lib/types";

const PUBLIC_URL = (process.env.OS_PUBLIC_URL || "https://brandyaction-os.vercel.app").replace(/\/$/, "");

function extractOutputText(response: Record<string, unknown>) {
  const output = Array.isArray(response.output) ? response.output : [];
  return output
    .flatMap((item) => (item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : []))
    .filter((content) => content && typeof content === "object" && (content as { type?: string }).type === "output_text")
    .map((content) => String((content as { text?: string }).text ?? ""))
    .join("\n")
    .trim();
}

export async function answerFromKnowledge(
  question: string,
  results: SearchResult[],
  prior?: { question: string; answer: string },
  conflictNotice = "",
) {
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
        instructions: "당신은 브랜디액션 사내 지식 도우미입니다. 제공된 회사 지식만 근거로 한국어로 짧고 명확하게 답하세요. 회사 지식은 우선순위순입니다. 사용법·절차 질문에는 첫 번째 절차 정본을 반드시 먼저 사용하고, 현재기준·결정 로그를 함께 대조해 실행 순서와 수치를 직접 답하세요. 분석 문서는 절차 정본을 대체할 수 없습니다. 관련 절차가 근거에 있으면 없다고 말하지 마세요. 후속 질문이면 직전 문답의 지시어를 해석하되, 사실은 반드시 이번 회사 지식으로 다시 검증하세요. 충돌 경고가 있으면 한 기준을 임의로 확정하지 마세요. 근거가 실제로 부족할 때만 모른다고 말하세요. 답 끝에는 실제 사용한 회사 지식의 번호만 [근거 1] 형식으로 표시하세요. 번호나 출처를 만들지 마세요.",
        input: `${prior ? `직전 질문:\n${prior.question}\n\n직전 답변:\n${prior.answer}\n\n` : ""}현재 질문:\n${question}\n\n${conflictNotice ? `검색 경고:\n${conflictNotice}\n\n` : ""}회사 지식:\n${evidence || "검색된 근거 없음"}`,
        max_output_tokens: 700,
      }),
      signal: controller.signal,
    });
    const body = await response.json();
    if (!response.ok) throw new ApiError(502, "ANSWER_PROVIDER_ERROR", "답변 생성에 실패했습니다.");
    const answer = extractOutputText(body);
    return answer ? formatKnowledgeAnswer(answer, results, PUBLIC_URL) : formatEvidenceOnly(results);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return formatEvidenceOnly(results);
    if (error instanceof ApiError) throw error;
    return formatEvidenceOnly(results);
  } finally { clearTimeout(timer); }
}

function formatEvidenceOnly(results: SearchResult[]) {
  if (!results.length) return "관련 회사 지식을 찾지 못했습니다. 질문의 핵심 단어를 바꿔 다시 물어봐 주세요.";
  const body = results.slice(0, 3).map((result, index) => `${index + 1}. ${result.title}\n${result.text.slice(0, 350)}`).join("\n\n");
  return formatKnowledgeAnswer(`회사 지식에서 찾은 내용입니다.\n\n${body}`, results, PUBLIC_URL);
}
