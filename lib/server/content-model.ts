import { ApiError } from "@/lib/http";

export interface ContentModelRequest {
  prompt: string;
  model: string;
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  timeoutMs?: number;
}

export const hasClaudeKey = () => Boolean((process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY)?.trim());
// ponytail: name-based check; Claude 4.6+ models reject sampling parameters with a 400.
const acceptsTemperature = (model: string) => /^claude-3|-4-[015](?:-\d{8})?$/.test(model);

// Provider-specific transport only. No automatic cross-provider fallback.
function outputText(body: Record<string, unknown>) {
  const content = Array.isArray(body.content) ? body.content : [];
  return content.filter((item) => item && typeof item === "object" && (item as { type?: string }).type === "text")
    .map((item) => String((item as { text?: string }).text ?? "")).join("\n").trim();
}

export async function generateContentText({ prompt, model, jsonSchema, maxTokens, effort, timeoutMs = 170_000 }: ContentModelRequest) {
  if (model.startsWith("gpt-6-")) return generateOpenAiContentText({ prompt, model, jsonSchema, maxTokens });
  const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!key) throw new ApiError(503, "CLAUDE_NOT_CONFIGURED", "Claude API 키가 아직 연결되지 않았습니다.");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, ...(acceptsTemperature(model) ? { temperature: 0.25 } : {}),
      output_config: { format: { type: "json_schema", schema: jsonSchema }, ...(effort ? { effort } : {}) }, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new ApiError(502, "CLAUDE_GENERATION_FAILED", "콘텐츠 생성 요청에 실패했습니다.");
  if (body.stop_reason === "refusal") throw new ApiError(502, "CLAUDE_REFUSED", "AI가 이 요청의 처리를 거절했습니다. 결과를 저장하지 않았습니다.");
  if (body.stop_reason === "max_tokens") throw new ApiError(502, "CLAUDE_OUTPUT_TRUNCATED", "AI 결과가 길이 제한에 걸렸습니다. 원문을 줄이거나 생성 범위를 나눠 주세요.");
  return outputText(body);
}

async function generateOpenAiContentText({ prompt, model, jsonSchema, maxTokens }: ContentModelRequest) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new ApiError(503, "OPENAI_NOT_CONFIGURED", "OpenAI API 키가 아직 연결되지 않았습니다.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(120_000),
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, input: [{ role: "user", content: prompt }], max_output_tokens: maxTokens,
      text: { format: { type: "json_schema", name: "content_result", strict: true, schema: jsonSchema } }, store: false }),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new ApiError(502, "OPENAI_GENERATION_FAILED", "OpenAI 콘텐츠 생성 요청에 실패했습니다.");
  if (body.status !== "completed") throw new ApiError(502, "OPENAI_OUTPUT_INCOMPLETE", "AI 결과가 완료되지 않았습니다. 원문을 줄이거나 생성 범위를 나눠 주세요.");
  const output = Array.isArray(body.output) ? body.output : [];
  const text = output.flatMap((item) => item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content)
    ? (item as { content: unknown[] }).content : []).filter((item) => item && typeof item === "object" && (item as { type?: string }).type === "output_text")
    .map((item) => String((item as { text?: string }).text ?? "")).join("\n").trim();
  if (!text) throw new ApiError(502, "OPENAI_OUTPUT_EMPTY", "AI가 빈 결과를 반환했습니다.");
  return text;
}
