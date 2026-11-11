import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// 음성 고르기 v2 (2026-11-11): the render PC makes every longform sentence four times and keeps the most natural take, so the price
// asked before the voice is made is four single passes; shorts keep one take plus a retake where it breaks.
const panel = readFileSync(new URL("../components/myin-v13-panel.tsx", import.meta.url), "utf8");

test("the longform voice price counts four takes a sentence; shorts keep 많게는 2배", () => {
  assert.match(panel, /amount: takes && !short \? estimate\.krw \* 4 : estimate\.krw/);
  assert.match(panel, /문장마다 4번 만들어 가장 자연스러운 것을 골라요/);
  assert.match(panel, /끊긴 문장은 한 번 더 만들어 많게는 2배/);
  assert.match(panel, /voiceEstimate\(voiceText, myinVoice\)\.krw \* \(voiceOnPc && !short \? 4 : 1\)/);
});

test("a longform voice lease grows with the script, so four takes a sentence are not refused as late; the panel's time follows", () => {
  const run = readFileSync(new URL("../lib/server/myin-run.ts", import.meta.url), "utf8");
  assert.match(run, /run\.voiceOn && !run\.layout \? WORDS_LEASE_MS \+ run\.paragraphs\.length \* 3 \* 60_000 : WORDS_LEASE_MS/);
  assert.match(run, /claim\(service, "words_pending", wordsLeaseMs, fits\(short\)/);
  assert.match(run, /typeof leaseMs === "function" \? leaseMs\(run\) : leaseMs/);
  assert.match(run, /Date\.parse\(run\.lease\.expiresAt\) < Date\.now\(\)/, "a late result is still refused");
  assert.match(panel, /run\.layout === "short" \? 8 : 10 \+ Math\.ceil\(run\.paragraphs \* 1\.75\)/);
});
