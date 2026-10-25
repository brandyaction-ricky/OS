import assert from "node:assert/strict";
import test from "node:test";
import { fishUsdPerMillion, voiceEstimate } from "../lib/youtube-process/cost.ts";

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
