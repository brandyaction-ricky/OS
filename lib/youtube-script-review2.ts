// 원고 「두 번째 검수」 (owner 2026-10-29): GPT judges 원고 검수 정본 관문 2~6 as the 별도 판정 of 원고 공정 정본 §12-3 — it gets
// the 원고 and the two canons the gates name (검수 정본; 말투 정본 for 관문 6), never the writing notes, the design or earlier verdicts.
import { z } from "zod";
import { myinCleanScript } from "./myin-script.ts";
import type { YpReview2 } from "./youtube-process/stages.ts";

export const REVIEW2_GATES = [2, 3, 4, 5, 6] as const;
export const REVIEW2_GATE_NAME: Record<(typeof REVIEW2_GATES)[number], string> = { 2: "약속", 3: "전진", 4: "장면과 도구", 5: "사실과 재료", 6: "청각 이해" };

/** The spoken 원고 with its paragraphs numbered from 1 (the numbers the judgement points at) and its section headings kept. */
export function numberedScript(md: string) {
  let n = 0;
  const lines = myinCleanScript(md).paras.map((para) => para.startsWith("#SECTION ") ? `## ${para.slice(9)}` : `[${++n}] ${para}`);
  return { text: lines.join("\n\n"), paragraphs: n };
}

const RULES = `당신은 [원고 공정 정본] §12-3이 말하는 「별도 판정」입니다. 이 원고를 쓴 과정·설계표·기대 답·앞선 판정은 받지 않았고, 받은 것은 아래 판정 기준 문서 두 편과 원고뿐입니다.

[원고 검수 정본]의 관문 2~6을 이 원고에 적용해 관문마다 통과/반려를 냅니다. 관문 6(청각 이해)은 [원고 말투 정본]도 기준으로 씁니다. 관문 1(형식)은 OS가 이미 코드로 셌으니 판정하지 않습니다.

지킬 것
- 지적마다 문단 번호(원고 앞의 [n])와 그 문단의 원문 문장을 그대로 붙입니다(quote). 교정안(fix)은 그 문장 하나에 대한 한 문장까지입니다. 문단을 다시 써 주지 않습니다.
- 반려 사유(reason)는 무엇이 비었는지 구조 문제로 씁니다(검수 정본 §0-4). 등급(상·중·하)과 통과 기준은 검수 정본 §0-5와 각 관문의 기준을 따릅니다. 하 등급은 목록만 넘기고 통과를 막지 않습니다.
- 관문 5: 원문 링크를 열 수 없습니다. 링크로만 확인되는 것은 반려하지 말고 doubts에 "확인 필요: …"로 적습니다. 원고 안에서 판단되는 것(식별 정보 없는 연구 인용, 출처 없는 1인칭 경험, 가격 언급, 성별 단정, 만든 후기 등)은 판정합니다.
- 우리 IP 용어(IP 사슬·6대 욕구·세부욕구)의 정의 문서는 이번 판정에 주지 않았습니다. 대조는 하지 말고, 쓰인 문단을 doubts에 "IP 용어 대조 필요: n번 문단"으로 적습니다.
- 영상의 역할(유입형·전환형·판매형)은 주지 않았습니다. 원고에서 분명히 드러나지 않으면 역할 정합은 판정하지 않습니다.
- 대표가 라이브에서 말하는 입말(근데·그래서로 여는 문장, 정말·진짜·너무, "~거든요", "~한 거죠")은 말투 정본이 정한 목소리입니다. 이것만으로 관문 6을 걸지 않습니다.
- 결함이 없으면 억지로 채우지 않습니다. 대신 doubts에 "맞아 보이는데 틀렸을 만한 것 / 빠진 것 / 확인 안 된 가정"을 하나씩 적습니다(검수 정본 §0-6).
- 모든 문장은 한국어로, 직원이 바로 읽고 고칠 수 있는 쉬운 말로 씁니다.`;

/** The stable part first (rules and canons: OpenAI caches a repeated prefix), then this video's 제목 and 원고. */
export function review2Prompt(canons: { review: string; tone: string }, video: { title: string; thumbCopy: string; script: string }) {
  const numbered = numberedScript(video.script);
  return {
    prefix: `${RULES}\n\n=== [원고 검수 정본] ===\n${canons.review}\n\n=== [원고 말투 정본] ===\n${canons.tone}`,
    prompt: `=== 이 영상 ===\n제목: ${video.title || "(없음)"}\n썸네일 카피: ${video.thumbCopy || "(없음)"}\n\n=== 원고 (문단 ${numbered.paragraphs}개) ===\n${numbered.text}`,
    paragraphs: numbered.paragraphs,
  };
}

const item = { type: "object", additionalProperties: false, required: ["paragraph", "quote", "grade", "reason", "fix"], properties: {
  paragraph: { type: "integer" }, quote: { type: "string" }, grade: { type: "string", enum: ["상", "중", "하"] }, reason: { type: "string" }, fix: { type: "string" } } };
export const REVIEW2_SCHEMA = { type: "object", additionalProperties: false, required: ["gates", "doubts"], properties: {
  gates: { type: "array", items: { type: "object", additionalProperties: false, required: ["gate", "pass", "items"], properties: {
    gate: { type: "integer", enum: [...REVIEW2_GATES] }, pass: { type: "boolean" }, items: { type: "array", items: item } } } },
  doubts: { type: "array", items: { type: "string" } } } };

const resultSchema = z.object({
  gates: z.array(z.object({ gate: z.number().int(), pass: z.boolean(),
    items: z.array(z.object({ paragraph: z.number().int(), quote: z.string().max(2_000), grade: z.enum(["상", "중", "하"]), reason: z.string().max(2_000), fix: z.string().max(2_000) })).max(60) })),
  doubts: z.array(z.string().max(1_000)).max(12),
});

/** GPT's JSON as the stored judgement: every gate 2~6 exactly once, items pointing at real paragraphs; null when it is not that. */
export function parseReview2(text: string, paragraphs: number): Pick<YpReview2, "pass" | "gates" | "doubts"> | null {
  let parsed: z.infer<typeof resultSchema>;
  try { parsed = resultSchema.parse(JSON.parse(text)); } catch { return null; }
  const gates = REVIEW2_GATES.map((gate) => parsed.gates.find((row) => row.gate === gate));
  if (gates.some((row) => !row) || parsed.gates.length !== REVIEW2_GATES.length) return null;
  const kept = gates.map((row, i) => ({ ...row!, gate: REVIEW2_GATES[i], items: row!.items.filter((it) => it.paragraph >= 1 && it.paragraph <= paragraphs) }));
  return { pass: kept.every((row) => row.pass), gates: kept, doubts: parsed.doubts };
}
