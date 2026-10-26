import { OPENAI_ANSWER_MODEL } from "@/lib/config";
import { ApiError } from "@/lib/http";
import { generateContentText, hasClaudeKey } from "@/lib/server/content-model";

// Shared by the web meeting workspace (app/api/v1/meeting-summary) and the
// Telegram /회의기록 command, so both surfaces extract meetings the same way.

export interface MeetingTodo { title: string; assignee: string; dueDate: string; dueLabel: string }
export interface MeetingSummary { summary: string; decisions: string[]; pending: string[]; todos: MeetingTodo[] }
export interface MeetingSummaryWithMode extends MeetingSummary { mode: "ai" | "local" }

function sentences(transcript: string) {
  return transcript.split(/\n|(?<=[.!?다요])\s+/).map((line) => line.replace(/^[-*]\s*/, "").trim()).filter((line) => line.length >= 8);
}

function localSummary(transcript: string): MeetingSummary {
  const lines = sentences(transcript);
  const decisions = lines.filter((line) => /(결정|합의|확정|하기로)/.test(line)).slice(0, 8);
  const pending = lines.filter((line) => /(미정|보류|확인 필요|논의 필요|추후|아직)/.test(line)).slice(0, 8);
  const actionLines = lines.filter((line) => /(담당|까지|해야|진행|요청|확인|준비)/.test(line)).slice(0, 10);
  return {
    summary: lines.slice(0, 6).map((line) => `- ${line}`).join("\n") || "- 요약할 문장이 부족합니다.",
    decisions,
    pending,
    todos: actionLines.map((title) => ({ title, assignee: "", dueDate: "", dueLabel: "" })),
  };
}

// Shared with lib/server/operating-baseline.ts — both parse the same
// Responses API output-text shape (json_schema or plain text).
export function jsonText(body: Record<string, unknown>) {
  const output = Array.isArray(body.output) ? body.output : [];
  return output.flatMap((item) => item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [])
    .filter((item) => item && typeof item === "object" && (item as { type?: string }).type === "output_text")
    .map((item) => String((item as { text?: string }).text ?? "")).join("\n").trim();
}

function normalize(value: unknown, fallback: MeetingSummary): MeetingSummary {
  if (!value || typeof value !== "object") return fallback;
  const item = value as Record<string, unknown>;
  const strings = (input: unknown) => Array.isArray(input) ? input.map(String).map((text) => text.trim()).filter(Boolean).slice(0, 20) : [];
  const todos: MeetingTodo[] = Array.isArray(item.todos) ? item.todos.flatMap((todo) => {
    if (!todo || typeof todo !== "object") return [];
    const row = todo as Record<string, unknown>;
    const title = String(row.title ?? "").trim();
    return title ? [{ title, assignee: String(row.assignee ?? "").trim(), dueDate: /^\d{4}-\d{2}-\d{2}$/.test(String(row.dueDate ?? "")) ? String(row.dueDate) : "", dueLabel: String(row.dueLabel ?? "").trim() }] : [];
  }).slice(0, 20) : [];
  return { summary: String(item.summary ?? fallback.summary).trim(), decisions: strings(item.decisions), pending: strings(item.pending), todos };
}

const SUMMARY_SCHEMA = { type: "object", additionalProperties: false, properties: { summary: { type: "string" }, decisions: { type: "array", items: { type: "string" } }, pending: { type: "array", items: { type: "string" } }, todos: { type: "array", items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, assignee: { type: "string" }, dueDate: { type: "string" }, dueLabel: { type: "string" } }, required: ["title", "assignee", "dueDate", "dueLabel"] } } }, required: ["summary", "decisions", "pending", "todos"] };

export interface MeetingSummaryContext { business?: string; people?: string[] }

// Claude reads the whole transcript (auto speech-to-text, so it has misheard words) and writes
// a topic summary plus decision / task / open candidates. Names only from the roster.
function claudeMeetingPrompt(transcript: string, date: string, { business, people = [] }: MeetingSummaryContext) {
  return `브랜디액션 사내 회의록을 정리합니다. 회의일 ${date}${business ? `, 사업 ${business}` : ""}.
원문은 음성 자동 전사라 잘못 들린 단어가 섞여 있습니다(예: "마인"·"마이 인"은 "마이인", "브랜디 에듀"는 "브랜디에듀", "OS"는 사내 업무 시스템). 문맥으로 바로잡되 원문에 없는 내용은 만들지 마세요.
${people.length ? `구성원 이름: ${people.join(", ")}. 담당자는 이 이름 중에서 원문에 나온 사람만 쓰고, 없으면 비워 두세요.
` : ""}
- summary: 논의 주제별로 "### 주제" 한 줄 뒤에 "- " 글머리표 2~5개. 주제는 3~8개. 잡담·인사·녹음 확인 말은 빼고, 숫자·기한·이유는 남깁니다.
- decisions: 회의에서 정하거나 합의한 것만. "~하기로 했다"처럼 한 문장.
- todos: 누군가 해야 할 일. title은 "무엇을 한다"로 끝나는 한 문장(동사로 끝). 담당자·기한은 원문에 있을 때만. 상대 기한은 회의일 기준 YYYY-MM-DD, 애매하면 dueDate는 비우고 원문 표현을 dueLabel에.
- pending: 결론 없이 다음 회의로 넘어간 질문·확인할 것.
- 같은 내용을 여러 칸에 중복해 넣지 마세요. 담당자나 기한을 절대 추측하지 마세요.

회의 원문:
${transcript}`;
}

/**
 * 회의 원문(transcript) → {요약, 결정사항, 미결사항, todos}. 원문에 없는 담당자·기한은
 * 절대 추측하지 않는다(OPENAI_API_KEY 없거나 호출 실패 시 규칙 기반 로컬 요약으로 대체).
 */
export async function summarizeMeetingText(transcript: string, meetingDate?: string, context: MeetingSummaryContext & { strict?: boolean } = {}): Promise<MeetingSummaryWithMode> {
  const fallback = localSummary(transcript);
  const date = meetingDate && /^\d{4}-\d{2}-\d{2}$/.test(meetingDate) ? meetingDate : new Date().toISOString().slice(0, 10);
  if (hasClaudeKey()) {
    try {
      const text = await generateContentText({ prompt: claudeMeetingPrompt(transcript, date, context), model: process.env.CLAUDE_SONNET_MODEL || "claude-sonnet-4-5-20250929", jsonSchema: SUMMARY_SCHEMA, maxTokens: 8000, timeoutMs: 170_000 });
      return { ...normalize(JSON.parse(text), fallback), mode: "ai" };
    } catch (error) {
      // The web asks for strict: a rule-based copy of the first sentences is worse than a clear retry.
      if (context.strict) throw error instanceof ApiError ? error : new ApiError(502, "MEETING_SUMMARY_FAILED", "AI 정리에 실패했습니다. 잠시 뒤 다시 눌러 주세요.");
    }
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { if (context.strict) throw new ApiError(503, "MEETING_SUMMARY_UNAVAILABLE", "AI 정리를 쓸 수 없습니다. AI 키 연결을 확인해 주세요."); return { ...fallback, mode: "local" }; }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_ANSWER_MODEL,
        instructions: `브랜디액션 사내 회의 기록 편집자입니다. 회의일은 ${date}입니다. 원문에 명시된 내용만 추출하고 담당자나 기한을 절대 추측하지 마세요. 상대 기한은 회의일을 기준으로 YYYY-MM-DD로 변환하되 불명확하면 dueDate를 비우고 원문 표현을 dueLabel에 남기세요. summary는 한국어 글머리표 문자열로 작성하세요. JSON만 출력하세요.`,
        input: transcript,
        text: { format: { type: "json_schema", name: "meeting_summary", strict: true, schema: { type: "object", additionalProperties: false, properties: { summary: { type: "string" }, decisions: { type: "array", items: { type: "string" } }, pending: { type: "array", items: { type: "string" } }, todos: { type: "array", items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, assignee: { type: "string" }, dueDate: { type: "string" }, dueLabel: { type: "string" } }, required: ["title", "assignee", "dueDate", "dueLabel"] } } }, required: ["summary", "decisions", "pending", "todos"] } } },
        max_output_tokens: 1800,
      }),
      signal: controller.signal,
    });
    const result = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error("openai");
    const raw = jsonText(result);
    return { ...normalize(raw ? JSON.parse(raw) : null, fallback), mode: "ai" };
  } catch {
    if (context.strict) throw new ApiError(502, "MEETING_SUMMARY_FAILED", "AI 정리에 실패했습니다. 잠시 뒤 다시 눌러 주세요.");
    return { ...fallback, mode: "local" };
  } finally {
    clearTimeout(timeout);
  }
}
