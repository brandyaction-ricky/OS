// GPT 초안 (owner 2026-10-29, ③ 파생 콘텐츠 자동 생산): the company's ChatGPT Pro API credit does the same staff-AI job cards
// straight away, so 업로드 자료 · SEO 칼럼 · 숏폼 주제 후보 are waiting when the 최종 검토 is confirmed. Also the 원고 두 번째 검수's models.
import { modelName } from "../cost.ts";

/** 정밀 = OpenAI's top model; 절약 = near it at about a fifth of the price (owner 2026-10-29: pick by how much credit is left). */
export const GPT_TIERS = { precise: { model: "gpt-6-astra", label: "정밀", effort: "high" }, saving: { model: "gpt-6.1-sol", label: "절약", effort: "medium" } } as const;
export type GptTier = keyof typeof GPT_TIERS;
/** The automatic runs switch to 절약 when this month's GPT credit left is under this (USD). */
export const GPT_SAVING_BELOW_USD = 50;

/** The staff-AI tasks GPT may do; the first three start by themselves at the 최종 검토 OK, 숏폼 대본 · 카드뉴스 초안 only from their buttons. */
export const GPT_DRAFT_TASKS = ["kit", "column", "short-topics", "short-script", "card"] as const;
export type GptDraftTask = (typeof GPT_DRAFT_TASKS)[number];
export const GPT_AUTO_TASKS = ["kit", "column", "short-topics"] as const satisfies readonly GptDraftTask[];
export const isGptTask = (task: string): task is GptDraftTask => (GPT_DRAFT_TASKS as readonly string[]).includes(task);

export const isGptModel = (model?: string | null) => Boolean(model?.startsWith("gpt-"));
/** The tag on a draft: 「GPT 초안 · GPT-6 Astra」 for the company GPT, 「AI 초안 · 이름」 for a staff member's own AI. */
export const draftTag = (by: string, model?: string | null) => isGptModel(model) ? `GPT 초안 · ${modelName(model!)}` : `AI 초안 · ${by}`;
