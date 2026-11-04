import { request } from "node:https";
import { ApiError } from "@/lib/http";

export interface ContentModelRequest {
  prompt: string;
  model: string;
  /** Omitted only for GPT: the answer is then any one JSON object (a staff-AI job card describes its own result shape). */
  jsonSchema?: Record<string, unknown>;
  maxTokens: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  timeoutMs?: number;
  /** GPT only: images shown with the prompt (the 화면 자동 검사's 점검 시트), by URL the provider can fetch. */
  images?: string[];
  /** Stable leading text reused across calls; sent with a cache breakpoint so repeats bill at the cache-read rate. */
  cachedPrefix?: string;
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

/** A JSON POST that waits as long as timeoutMs: the built-in fetch drops any answer whose headers take over 5 minutes ("fetch failed"),
 * which a long 웹툰 card on GPT-6 high effort does (2026-11-04). */
function postJson(url: string, headers: Record<string, string>, payload: unknown, timeoutMs: number) {
  const body = JSON.stringify(payload);
  return new Promise<{ ok: boolean; body: Record<string, unknown> }>((resolve, reject) => {
    const req = request(url, { method: "POST", headers: { ...headers, "content-type": "application/json", "content-length": Buffer.byteLength(body) }, signal: AbortSignal.timeout(timeoutMs) }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => {
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* an error page: the caller reports !ok */ }
        resolve({ ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300, body: parsed });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

export async function generateContentText({ prompt, model, jsonSchema, maxTokens, effort, timeoutMs = 170_000, cachedPrefix, images }: ContentModelRequest) {
  if (model.startsWith("gpt-6")) return generateOpenAiContentText(   // gpt-6-astra · gpt-6-luna · gpt-6.1-sol · gpt-6.1-terra
    { prompt: cachedPrefix ? `${cachedPrefix}\n\n${prompt}` : prompt, model, jsonSchema, maxTokens, effort, timeoutMs, images });
  const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!key) throw new ApiError(503, "CLAUDE_NOT_CONFIGURED", "Claude API 키가 아직 연결되지 않았습니다.");
  const { ok, body } = await postJson("https://api.anthropic.com/v1/messages", { "x-api-key": key, "anthropic-version": "2023-06-01" },
    { model, max_tokens: maxTokens, ...(acceptsTemperature(model) ? { temperature: 0.25 } : {}),
      output_config: { format: { type: "json_schema", schema: jsonSchema }, ...(effort ? { effort } : {}) }, messages: [{ role: "user", content: cachedPrefix
        ? [{ type: "text", text: cachedPrefix, cache_control: { type: "ephemeral" } }, { type: "text", text: prompt }] : prompt }] }, timeoutMs);
  if (!ok) throw new ApiError(502, "CLAUDE_GENERATION_FAILED", "콘텐츠 생성 요청에 실패했습니다.");
  if (body.stop_reason === "refusal") throw new ApiError(502, "CLAUDE_REFUSED", "AI가 이 요청의 처리를 거절했습니다. 결과를 저장하지 않았습니다.");
  if (body.stop_reason === "max_tokens") throw new ApiError(502, "CLAUDE_OUTPUT_TRUNCATED", "AI 결과가 길이 제한에 걸렸습니다. 원문을 줄이거나 생성 범위를 나눠 주세요.");
  return outputText(body);
}

async function generateOpenAiContentText({ prompt, model, jsonSchema, maxTokens, effort, timeoutMs = 120_000, images }: ContentModelRequest) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new ApiError(503, "OPENAI_NOT_CONFIGURED", "OpenAI API 키가 아직 연결되지 않았습니다.");
  const { ok, body } = await postJson("https://api.openai.com/v1/responses", { authorization: `Bearer ${key}` },
    // GPT-6 takes the same effort names (low · medium · high · xhigh · max; developers.openai.com, checked 2026-10-29).
    { model, input: [{ role: "user", content: images?.length ? [{ type: "input_text", text: prompt }, ...images.map((url) => ({ type: "input_image", image_url: url, detail: "high" }))] : prompt }], max_output_tokens: maxTokens, ...(effort ? { reasoning: { effort } } : {}),
      text: { format: jsonSchema ? { type: "json_schema", name: "content_result", strict: true, schema: jsonSchema } : { type: "json_object" } }, store: false }, timeoutMs);
  if (!ok) throw new ApiError(502, "OPENAI_GENERATION_FAILED", "OpenAI 콘텐츠 생성 요청에 실패했습니다.");
  if (body.status !== "completed") throw new ApiError(502, "OPENAI_OUTPUT_INCOMPLETE", "AI 결과가 완료되지 않았습니다. 원문을 줄이거나 생성 범위를 나눠 주세요.");
  const output = Array.isArray(body.output) ? body.output : [];
  const text = output.flatMap((item) => item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content)
    ? (item as { content: unknown[] }).content : []).filter((item) => item && typeof item === "object" && (item as { type?: string }).type === "output_text")
    .map((item) => String((item as { text?: string }).text ?? "")).join("\n").trim();
  if (!text) throw new ApiError(502, "OPENAI_OUTPUT_EMPTY", "AI가 빈 결과를 반환했습니다.");
  return text;
}
