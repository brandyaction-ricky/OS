import { ApiError } from "@/lib/http";

export interface ContentModelRequest {
  prompt: string;
  model: string;
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
}

// Provider-specific transport only. No automatic cross-provider fallback.
function outputText(body: Record<string, unknown>) {
  const content = Array.isArray(body.content) ? body.content : [];
  return content.filter((item) => item && typeof item === "object" && (item as { type?: string }).type === "text")
    .map((item) => String((item as { text?: string }).text ?? "")).join("\n").trim();
}

export async function generateContentText({ prompt, model, jsonSchema, maxTokens }: ContentModelRequest) {
  const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!key) throw new ApiError(503, "CLAUDE_NOT_CONFIGURED", "Claude API 키가 아직 연결되지 않았습니다.");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.25, output_config: { format: { type: "json_schema", schema: jsonSchema } }, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(90_000),
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new ApiError(502, "CLAUDE_GENERATION_FAILED", "콘텐츠 생성 요청에 실패했습니다.");
  if (body.stop_reason === "max_tokens") throw new ApiError(502, "CLAUDE_OUTPUT_TRUNCATED", "AI 결과가 길이 제한에 걸렸습니다. 원문을 줄이거나 생성 범위를 나눠 주세요.");
  return outputText(body);
}
