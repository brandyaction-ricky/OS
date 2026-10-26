// Company-money estimates shown before a paid button runs (owner request 2026-10-25).

/**
 * Fish Audio TTS, USD per 1M UTF-8 bytes (docs.fish.audio pricing, checked 2026-10-25): drama-3 (자동 제작 voice) $50, $10 until
 * 2026-11-12 17:00 UTC; s1 · s2-pro · s2.1-pro (숏폼 narration, FISH_TTS_MODEL default) $15. A Korean letter is 3 bytes.
 */
export const fishUsdPerMillion = (model: string, now = Date.now()) => model === "drama-3" ? (now < Date.parse("2026-11-12T17:00:00Z") ? 10 : 50) : 15;
// ponytail: fixed rate for an estimate shown as "약"; read a live rate if the amounts ever matter to the 원.
const KRW_PER_USD = 1400;
export function voiceEstimate(text: string, model = "s2.1-pro", now = Date.now()) {
  const usd = new TextEncoder().encode(text).length * fishUsdPerMillion(model, now) / 1_000_000;
  return { chars: [...text.replace(/\s/g, "")].length, usd, krw: Math.max(1, Math.round(usd * KRW_PER_USD)) };
}
/** Meeting AI 정리 on Claude Sonnet: $3 per 1M input tokens, $15 per 1M output (about 4k); a Korean letter is roughly one token. */
export function meetingSummaryEstimate(text: string) {
  const usd = text.length * 3 / 1_000_000 + 4000 * 15 / 1_000_000;
  return { chars: text.length, krw: Math.max(1, Math.round(usd * KRW_PER_USD)) };
}
/** Meeting recording to text on OpenAI gpt-4o-mini-transcribe: $0.003 per minute. */
export const transcriptionKrwPerHour = Math.round(0.003 * 60 * KRW_PER_USD);
