import { z } from "zod";
import { JEV_SYSTEM_ONE_ENDPOINT } from "@/lib/server/content-jev-assist";

export const CONTENT_TOPIC_JEV_ASSIST_CONTRACT = "jev-content-topic-planning-advisory-v1";

const fieldsSchema = z.object({
  topic: z.string().trim().min(1).max(300),
  description: z.string().trim().max(4_000),
  audience: z.string().trim().max(1_000),
  entryLanguage: z.string().trim().max(1_000),
  hierarchy: z.string().trim().max(100),
  evidence: z.string().trim().max(4_000),
  sourceUrl: z.string().trim().max(2_000),
  researchSources: z.string().trim().max(4_000),
  analystNotes: z.string().trim().max(4_000),
  planningSummary: z.string().trim().max(4_000),
  handoff: z.string().trim().max(4_000),
}).strict();

const rubric = (items: string[]) => Object.fromEntries(items.map((item, index) => [String(index), item]));
const criteria = {
  targetFit: {
    label: "타깃의 실제 고민",
    rubric: rubric(["주제와 타깃의 연결을 자료에서 찾기 어렵습니다.", "타깃과 관련은 있지만 구체적인 장면이나 고민이 보이지 않습니다.", "관련된 고민은 보이지만 누구의 어떤 상황인지 더 분명해야 합니다.", "타깃의 구체적인 상황과 주제가 잘 연결됩니다.", "타깃의 실제 장면과 지금 막힌 판단이 구체적으로 맞닿아 있습니다."]),
    improvement: "누가 어떤 상황에서 무엇을 판단하기 어려운지 한 장면으로 적어 보세요.",
  },
  personalQuestion: {
    label: "자기 경험에 대입할 질문",
    rubric: rubric(["시청자가 자신에게 던질 질문이 드러나지 않습니다.", "넓은 질문은 있으나 시청자의 경험과 연결하기 어렵습니다.", "질문은 짐작되지만 한 가지로 좁히면 좋겠습니다.", "자신의 경험을 돌아볼 질문이 분명합니다.", "질문이 구체적이고 시청자가 자기 상황에 바로 대입할 수 있습니다."]),
    improvement: "시청자가 실제로 할 법한 질문을 한 문장으로 써 보세요.",
  },
  viewerValue: {
    label: "영상 자체의 도움",
    rubric: rubric(["시청자가 얻을 판단 재료가 확인되지 않습니다.", "도움의 방향은 있으나 영상에서 얻을 구체적인 것이 모호합니다.", "도움은 예상되지만 질문·구분 기준·작은 적용 중 하나를 정하면 더 분명해집니다.", "시청자가 자신의 경험에 적용할 구분이나 단서를 얻을 수 있습니다.", "영상이 약속하는 도움과 시청자의 다음 판단이 구체적으로 연결됩니다."]),
    improvement: "시청자가 보고 난 뒤 얻을 질문, 구분 기준 또는 작은 적용을 적어 보세요.",
  },
  evidence: {
    label: "근거와 확인 범위",
    rubric: rubric(["주요 주장을 확인할 근거가 제공되지 않았습니다.", "근거가 일부 있으나 어떤 주장에 연결되는지 불분명합니다.", "근거가 주제와 연결되지만 사실·해석·가설을 구분할 부분이 있습니다.", "근거가 주장을 뒷받침하고 확인 범위도 대체로 드러납니다.", "주장별 근거와 사실·해석·가설의 경계가 명확합니다."]),
    improvement: "주요 주장마다 출처를 연결하고 사실, 해석, 아직 확인하지 않은 가설을 나눠 적으세요.",
  },
  distinctAnswer: {
    label: "새로운 답과 도달 근거",
    rubric: rubric(["비교 자료가 없어 새로움이나 도달 가능성을 판단하기 어렵습니다.", "차별점 또는 시청자 언어의 근거가 아직 확인되지 않았습니다.", "새로운 답이나 도달 근거 중 하나가 일부 제시됐습니다.", "기존 답과 다른 점 및 시청자 언어·사례의 근거가 보입니다.", "기존 영상과의 차이와 실제 시청자 언어·벤치마크 근거가 구체적입니다."]),
    improvement: "비교할 기존 영상·시청자 표현·벤치마크 중 확인한 자료를 추가하고, 없으면 미검증이라고 표시하세요.",
  },
} as const;

export const CONTENT_TOPIC_JEV_QUESTIONS = Object.freeze(Object.fromEntries(
  Object.entries(criteria).map(([key, item]) => [key, {
    type: "choice",
    instructions: `주제·기획 보조 검토 항목: ${item.label}. 입력된 정보만 평가하고 정보가 없으면 낮은 점수를 추측하지 말고 가장 근접한 판단과 낮은 확신도를 표시한다. 점수는 정답·채택 기준이 아니다.`,
    criteria: item.rubric,
  }]),
));

const choiceSchema = z.object({ type: z.literal("choice"), choice: z.enum(["0", "1", "2", "3", "4"]), confidence: z.number().min(0).max(1) }).passthrough();
const responseSchema = z.object({
  model: z.string().min(1).max(100),
  answers: z.object({
    targetFit: choiceSchema,
    personalQuestion: choiceSchema,
    viewerValue: choiceSchema,
    evidence: choiceSchema,
    distinctAnswer: choiceSchema,
  }).strict(),
}).passthrough();

function present(value: string) { return value || "미확인"; }

export function buildContentTopicJevState(input: unknown) {
  const data = fieldsSchema.parse(input);
  return [
    "현재 단계: 유튜브 주제·기획. 제목·썸네일 최종 제작, 원고, 촬영·발행, 발행 후 성과는 평가하지 않는다.",
    `주제: ${data.topic}`,
    `주제 설명·시청자 문제: ${present(data.description)}`,
    `타깃: ${present(data.audience)}`,
    `검색되는 입구 언어: ${present(data.entryLanguage)}`,
    `콘텐츠 위계: ${present(data.hierarchy)}`,
    `근거 메모: ${present(data.evidence)}`,
    `근거 영상 URL: ${present(data.sourceUrl)}`,
    `리서치 출처 URL: ${present(data.researchSources)}`,
    `분석 메모: ${present(data.analystNotes)}`,
    `기획 요약: ${present(data.planningSummary)}`,
    `다음 단계 인계 메모: ${present(data.handoff)}`,
    "비어 있거나 미확인인 항목은 추측해 채우지 않는다. 시장 수요, 성과, 채택 여부를 보장하지 않는다.",
  ].join("\n");
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
export async function evaluateContentTopicJev(input: unknown, options: { apiKey: string; model?: string; fetcher?: Fetcher; signal?: AbortSignal }) {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error("TOPIC_JEV_NOT_CONFIGURED");
  const material = fieldsSchema.parse(input);
  const state = buildContentTopicJevState(material);
  const response = await (options.fetcher ?? fetch)(JEV_SYSTEM_ONE_ENDPOINT, {
    method: "POST", signal: options.signal,
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ state, model: options.model?.trim() || "jev-latest", questions: CONTENT_TOPIC_JEV_QUESTIONS }),
  });
  if (!response.ok) throw new Error(`TOPIC_JEV_PROVIDER_HTTP_${response.status}`);
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > 200_000) throw new Error("TOPIC_JEV_RESPONSE_TOO_LARGE");
  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw new Error("TOPIC_JEV_INVALID_RESPONSE"); }
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) throw new Error("TOPIC_JEV_INVALID_RESPONSE");

  const scored = Object.entries(criteria).map(([key, item]) => {
    const answer = parsed.data.answers[key as keyof typeof parsed.data.answers];
    const score = Number(answer.choice) as 0 | 1 | 2 | 3 | 4;
    const meaning = item.rubric[String(score) as keyof typeof item.rubric];
    const missing = score <= 1 ? item.improvement : "";
    return { key, label: item.label, score, explanation: meaning, confidence: answer.confidence, improvement: missing };
  });
  const overall = Number((scored.reduce((sum, item) => sum + item.score, 0) / scored.length).toFixed(1));
  const uncertainties = [
    ...(!material.description ? ["주제 설명이 비어 있어 주제와 시청자 고민의 연결을 확인하기 어렵습니다."] : []),
    ...(!material.audience ? ["타깃 정보가 없어 대상과 주제의 적합성을 확인하기 어렵습니다."] : []),
    ...(!material.evidence && !material.sourceUrl && !material.researchSources && !material.analystNotes ? ["근거 메모, 리서치 출처, 분석 메모가 없어 근거 범위를 확인할 수 없습니다."] : []),
    ...(!material.planningSummary ? ["기획 요약이 없어 완성된 기획 방향을 충분히 평가하지 못했습니다."] : []),
    ...scored.filter((item) => item.confidence < 0.55).map((item) => `${item.label}: JEV의 확신도가 낮습니다.`),
  ];
  const improvements = scored.filter((item) => item.improvement).map((item) => item.improvement);
  return Object.freeze({
    contractVersion: CONTENT_TOPIC_JEV_ASSIST_CONTRACT,
    model: parsed.data.model,
    overallScore: overall,
    scale: "0~4",
    criteria: scored,
    uncertainties: [...new Set(uncertainties)],
    improvements: [...new Set(improvements)],
    advisoryOnly: true as const,
    saved: false as const,
  });
}
