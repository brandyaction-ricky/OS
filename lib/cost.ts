// What a button costs, shown before it runs (owner requests 2026-10-25 · 10-26: 「모든 페이지에 있는 버튼 하나도 빠짐없이」, the model
// and the cost only). Prices are the providers' official pages; the models are the server's, read through GET /api/v1/costs.

// ponytail: fixed rate for an estimate shown as "약"; read a live rate if the amounts ever matter to the 원.
const KRW_PER_USD = 1400;
export const won = (usd: number) => Math.max(1, Math.round(usd * KRW_PER_USD));

/**
 * Fish Audio TTS, USD per 1M UTF-8 bytes (docs.fish.audio pricing, checked 2026-10-25): drama-3 (자동 제작 voice) $50, $10 until
 * 2026-11-12 17:00 UTC; s1 · s2-pro · s2.1-pro (숏폼 narration, FISH_TTS_MODEL default) $15. A Korean letter is 3 bytes.
 */
export const fishUsdPerMillion = (model: string, now = Date.now()) => model === "drama-3" ? (now < Date.parse("2026-11-12T17:00:00Z") ? 10 : 50) : 15;
export function voiceEstimate(text: string, model = "s2.1-pro", now = Date.now()) {
  const usd = new TextEncoder().encode(text).length * fishUsdPerMillion(model, now) / 1_000_000;
  return { chars: [...text.replace(/\s/g, "")].length, usd, krw: won(usd) };
}

/**
 * USD per 1M tokens, input and output (platform.claude.com pricing, checked 2026-10-26); Claude Haiku 5.5 bills a prompt over
 * 100,000 tokens at the higher pair. The 4.5 rows stay for a server whose CLAUDE_*_MODEL still names one.
 */
const TOKEN_USD: [prefix: string, name: string, input: number, output: number, long?: [input: number, output: number]][] = [
  ["claude-haiku-5-5", "Claude Haiku 5.5", 0.1, 0.5, [0.5, 2.5]],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5", 2, 10],
  ["claude-opus-5-5", "Claude Opus 5.5", 4, 20],
  ["claude-sonnet-4-5", "Claude Sonnet 4.5", 3, 15],
  ["claude-haiku-4-5", "Claude Haiku 4.5", 1, 5],
];
/** USD per audio minute (developers.openai.com pricing, checked 2026-10-26). */
const MINUTE_USD: Record<string, number> = { "gpt-4o-mini-transcribe": 0.003 };
const tokenRow = (model: string) => TOKEN_USD.find(([prefix]) => model.startsWith(prefix));

export const modelName = (model: string) => /^(s1|s2|drama)/.test(model) ? `Fish Audio ${model}`
  : tokenRow(model)?.[1] ?? (MINUTE_USD[model] ? `OpenAI ${model}` : model);

// ponytail: one token per Korean letter is the planning figure for these upper bounds; count with the provider's tokenizer if a
// screen ever shows exact amounts.
/** 원 for a request of at most `input` and `output` tokens, or null when the model is not in the table. */
export function tokenEstimate(model: string, input: number, output: number) {
  const row = tokenRow(model);
  if (!row) return null;
  const [inUsd, outUsd] = row[4] && input > 100_000 ? row[4] : [row[2], row[3]];
  return won((input * inUsd + output * outUsd) / 1_000_000);
}
/** 원 for `minutes` of audio, or null when the model is not in the table. */
export const minuteEstimate = (model: string, minutes: number) => MINUTE_USD[model] ? won(MINUTE_USD[model] * minutes) : null;

/**
 * Company-AI generation (lib/server/content-generation.ts): the model tier and the most it may write, per action. The server takes
 * its token budget from here. Its input is the matching 정본 (up to 65,000 letters) plus the source, so the estimate is an upper bound.
 */
export const GENERATION = {
  appeal_candidates: { tier: "haiku", output: 7_000 }, topic_plan: { tier: "haiku", output: 7_000 }, title_package: { tier: "haiku", output: 7_000 },
  shorts_proposal: { tier: "haiku", output: 7_000 }, script_draft: { tier: "haiku", output: 9_000 },
  youtube_kit: { tier: "sonnet", output: 9_000 }, derivatives: { tier: "sonnet", output: 14_000 }, comment_reply: { tier: "haiku", output: 2_000 },
} as const;
export type GenerationAction = keyof typeof GENERATION;
export const GENERATION_INPUT = 85_000;

/** The models each paid button uses on the server; the defaults are lib/config.ts's (CLAUDE_FAST_MODEL · CLAUDE_SMART_MODEL). */
export interface CostModels { voice: string; myinVoice: string; haiku: string; sonnet: string; transcribe: string }
export const DEFAULT_COST_MODELS: CostModels = {
  voice: "s2.1-pro", myinVoice: "drama-3", haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5",
  transcribe: "gpt-4o-mini-transcribe",
};
