import assert from "node:assert/strict";
import test from "node:test";
import { fishUsdPerMillion, voiceEstimate } from "../lib/cost.ts";

// 비용 확인 팝업 (owner request 2026-10-25): Fish bills UTF-8 bytes, so a Korean letter counts three times; drama-3 drops to its
// list price when the launch offer ends.
test("the voice estimate counts UTF-8 bytes at the model's price", () => {
  const before = Date.parse("2026-10-25T00:00:00Z"), after = Date.parse("2026-11-13T00:00:00Z");
  assert.equal(fishUsdPerMillion("s2.1-pro", before), 15);
  assert.equal(fishUsdPerMillion("drama-3", before), 10);
  assert.equal(fishUsdPerMillion("drama-3", after), 50);
  const script = "가".repeat(7200);
  assert.equal(voiceEstimate(script, "drama-3", after).krw, Math.round(7200 * 3 * 50 / 1e6 * 1400));
  assert.equal(voiceEstimate("가 나", "s2.1-pro", before).chars, 2);
  assert.equal(voiceEstimate("짧", "s2.1-pro", before).krw, 1, "never shows 0원");
});

// 모든 버튼 비용 안내 (owner request 2026-10-26): the popup names the model and an estimate from the providers' price pages.
test("token, minute and model estimates use the official prices", async () => {
  const { tokenEstimate, minuteEstimate, modelName, GENERATION, GENERATION_INPUT } = await import("../lib/cost.ts");
  assert.equal(tokenEstimate("claude-haiku-4-5-20251001", 1_000_000, 0), 1400, "Haiku input $1 per 1M tokens");
  assert.equal(tokenEstimate("claude-sonnet-4-5-20250929", 0, 1_000_000), 15 * 1400, "Sonnet output $15 per 1M tokens");
  assert.equal(tokenEstimate("some-new-model", 10, 10), null, "an unknown model shows no amount instead of a wrong one");
  assert.equal(minuteEstimate("gpt-4o-mini-transcribe", 60), Math.round(0.18 * 1400), "an hour of recording");
  assert.equal(modelName("claude-haiku-4-5-20251001"), "Claude Haiku 4.5");
  assert.equal(modelName("s2.1-pro"), "Fish Audio s2.1-pro");
  assert.equal(modelName("gpt-4o-mini-transcribe"), "OpenAI gpt-4o-mini-transcribe");
  assert.equal(tokenEstimate("claude-sonnet-4-5", GENERATION_INPUT, GENERATION.derivatives.output), Math.round((85_000 * 3 + 14_000 * 15) / 1e6 * 1400));
});

test("the server's generation budgets come from the same table as the popup", async () => {
  const { readFileSync } = await import("node:fs");
  const server = readFileSync(new URL("../lib/server/content-generation.ts", import.meta.url), "utf8");
  assert.match(server, /tokenBudget = \(action[^)]*\) => GENERATION\[action\]\.output/);
  assert.match(server, /GENERATION\.comment_reply\.output/);
});
