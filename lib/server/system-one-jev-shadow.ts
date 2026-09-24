import { z } from "zod";

export const JEV_PACKAGING_SHADOW_CONTRACT = "jev-content-packaging-shadow-v2";
export const JEV_SYSTEM_ONE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

const materialSchema = z.object({
  title: z.string().trim().min(1).max(300),
  thumbnailCopy: z.string().trim().min(1).max(500),
  audience: z.string().trim().min(1).max(1_000),
  coreContent: z.string().trim().min(1).max(4_000),
  evidenceNotes: z.string().trim().min(1).max(4_000),
  viewerPromise: z.string().trim().min(1).max(1_000),
}).strict();

const scoreAnswer = z.object({
  type: z.literal("score"), score: z.number().min(0).max(4), confidence: z.number().min(0).max(1),
  probabilities: z.object({ "0": z.number(), "1": z.number(), "2": z.number(), "3": z.number(), "4": z.number() }).strict(),
  legend: z.record(z.unknown()),
}).passthrough();
const riskAnswer = z.object({
  type: z.literal("choice"), choice: z.enum(["low", "medium", "high"]), confidence: z.number().min(0).max(1),
  probabilities: z.object({ low: z.number(), medium: z.number(), high: z.number() }).strict(),
}).passthrough();
const responseSchema = z.object({
  model: z.string().min(1).max(100),
  answers: z.object({
    topic_relevance: scoreAnswer,
    thumbnail_clarity: scoreAnswer,
    curiosity_strength: scoreAnswer,
    evidence_boundary: scoreAnswer,
    overclaim_risk: riskAnswer,
  }).strict(),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }).strict(),
}).passthrough();

export type JevPackagingMaterial = z.infer<typeof materialSchema>;
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export const JEV_PACKAGING_QUESTIONS = Object.freeze({
  topic_relevance: { type: "score", instructions: "이 주제가 타깃 시청자의 현재 일과 의사결정에 얼마나 직접적으로 관련되는지 평가한다.", criteria: [
    "관련성이 거의 없다", "간접적인 관련만 있다", "관련은 있지만 긴급하거나 구체적이지 않다", "직접적이고 구체적인 관련이 있다", "매우 직접적이며 지금 확인할 이유가 분명하다",
  ] },
  thumbnail_clarity: { type: "score", instructions: "제목을 보지 않고 썸네일 카피만 읽었을 때 영상이 다룰 핵심 문제가 얼마나 분명한지 평가한다.", criteria: [
    "내용을 추론하기 어렵다", "분야만 짐작할 수 있다", "핵심 문제를 대략 짐작할 수 있다", "핵심 문제가 분명하다", "핵심 문제와 시청 이유가 모두 즉시 분명하다",
  ] },
  curiosity_strength: { type: "score", instructions: "제목과 썸네일 조합이 답을 확인하고 싶게 만드는 정보 격차를 얼마나 강하게 만드는지 평가한다.", criteria: [
    "궁금증이 거의 없다", "약한 궁금증만 생긴다", "일정한 궁금증이 생긴다", "강한 궁금증이 생긴다", "즉시 클릭하고 싶을 정도로 강하다",
  ] },
  evidence_boundary: { type: "score", instructions: "제시된 설명이 사실, 시나리오, 해석의 경계를 얼마나 명확하게 구분하는지 평가한다.", criteria: [
    "구분이 없어 오해 위험이 매우 크다", "구분이 불명확하다", "일부 구분하지만 혼동 가능성이 있다", "대체로 명확히 구분한다", "명시적이고 일관되게 구분한다",
  ] },
  overclaim_risk: { type: "choice", instructions: "제목과 썸네일이 근거가 허용하는 범위를 넘어 단정하거나 과장할 위험 수준을 선택한다.", criteria: {
    low: "근거 범위와 표현이 잘 맞아 과장 위험이 낮다",
    medium: "핵심 표현은 유지할 수 있지만 조건·근거 단서를 추가해야 오도 위험을 관리할 수 있다",
    high: "조건·근거 단서를 덧붙이는 것만으로 부족하며 제목·썸네일의 핵심 표현을 바꿔야 한다",
  } },
} as const);

export function buildJevPackagingState(input: unknown) {
  const material = materialSchema.parse(input);
  return [
    "콘텐츠 형식: 유튜브 콘텐츠", `타깃: ${material.audience}`, `제목: ${material.title}`,
    `썸네일 카피: ${material.thumbnailCopy}`, `핵심 내용: ${material.coreContent}`,
    `근거 처리: ${material.evidenceNotes}`, `시청자 약속: ${material.viewerPromise}`,
  ].join("\n");
}

export async function evaluateJevPackagingShadow(input: unknown, options: {
  apiKey: string; model?: string; fetcher?: Fetcher; signal?: AbortSignal;
}) {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error("JEV_NOT_CONFIGURED");
  const state = buildJevPackagingState(input);
  const fetcher = options.fetcher ?? fetch;
  const startedAt = Date.now();
  const response = await fetcher(JEV_SYSTEM_ONE_ENDPOINT, {
    method: "POST", signal: options.signal,
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ state, model: options.model?.trim() || "jev-latest", questions: JEV_PACKAGING_QUESTIONS }),
  });
  if (!response.ok) throw new Error(`JEV_PROVIDER_HTTP_${response.status}`);
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > 200_000) throw new Error("JEV_RESPONSE_TOO_LARGE");
  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw new Error("JEV_INVALID_RESPONSE"); }
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) throw new Error("JEV_INVALID_RESPONSE");
  return Object.freeze({
    contractVersion: JEV_PACKAGING_SHADOW_CONTRACT,
    mode: "shadow" as const,
    policyStatus: "pilot_noncanonical" as const,
    executionAllowed: false as const,
    judgment: null,
    model: parsed.data.model,
    scores: Object.freeze({
      topicRelevance: parsed.data.answers.topic_relevance,
      thumbnailClarity: parsed.data.answers.thumbnail_clarity,
      curiosityStrength: parsed.data.answers.curiosity_strength,
      evidenceBoundary: parsed.data.answers.evidence_boundary,
    }),
    overclaimRisk: parsed.data.answers.overclaim_risk,
    usage: parsed.data.usage,
    evaluationTimeMs: Date.now() - startedAt,
  });
}
