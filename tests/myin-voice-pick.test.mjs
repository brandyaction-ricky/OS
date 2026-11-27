import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// 음성 고르기 v2 (2026-11-11) asked for four takes a sentence; since 2026-11-25 the render PC voices a longform paragraph once
// (pkg-staging-20261125-guide), so the price is one pass; shorts keep one take plus a retake where it breaks.
const panel = readFileSync(new URL("../components/myin-v13-panel.tsx", import.meta.url), "utf8");

test("the longform voice price is one pass a paragraph; shorts keep 많게는 2배; 풀링형 has no 구독 대사 in the start confirm", () => {
  assert.match(panel, /amount: estimate\.krw,/);
  assert.match(panel, /문단마다 한 번에 만들어요/);
  assert.doesNotMatch(panel, /문장마다 4번/);
  assert.match(panel, /끊긴 문장은 한 번 더 만들어 많게는 2배/);
  assert.match(panel, /amount: voice\.krw \+ \(pulling \? 0 : cta\.krw\) \+ photos \+ again\.krw/);
  // 고친 문장만 다시 (11-16): with a changed script the tag counts only the paragraphs the earlier voice lacks.
  assert.match(panel, /voiceEstimate\(run\?\.scriptChanged && run\.voiceReuse \? run\.voiceReuse\.text : voiceText, myinVoice\)\.krw/);
});

test("a longform voice lease grows with the script, so four takes a sentence are not refused as late; the panel's time follows", () => {
  const run = readFileSync(new URL("../lib/server/myin-run.ts", import.meta.url), "utf8");
  assert.match(run, /run\.voiceOn && !run\.layout \? WORDS_LEASE_MS \+ run\.paragraphs\.length \* 3 \* 60_000 : WORDS_LEASE_MS/);
  assert.match(run, /claim\(service, "words_pending", wordsLeaseMs, \(run\) => fits\(short\)\(run\)/);
  assert.match(run, /typeof leaseMs === "function" \? leaseMs\(run\) : leaseMs/);
  assert.match(run, /Date\.parse\(run\.lease\.expiresAt\) < Date\.now\(\)/, "a late result is still refused");
  assert.match(panel, /run\.layout === "short" \? 8 : 8 \+ Math\.ceil\(run\.paragraphs \* 0\.2\)/);
});
