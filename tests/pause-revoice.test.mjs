import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { planVoiceFix } from "../lib/myin-voice-plan.ts";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("a pause-check memo finds its sentence the way voice_fix does (words around the pause, then the time)", () => {
  const sentences = [{ at: 0, text: "오늘은 재능 이야기를 해 볼게요." }, { at: 12.4, text: "시험 점수처럼 숫자가 있는 능력은 금방 보입니다." }, { at: 20, text: "그런데 대부분은 아니죠." }];
  const memo = "0:13.0 시험 점수처럼 숫자가 있는 능력은 (쉼 점검: 덩어리 끊김 0.1초)";
  const plan = planVoiceFix([{ memo }, { memo: "0:13.5 숫자가 있는 능력은 (쉼 점검: 띄워 읽음 0.2초)" }], sentences);
  assert.equal(plan.targets.length, 1, "two places in one sentence are one fix");
  assert.equal(plan.targets[0].index, 1);
  assert.equal(plan.fixes.length, 1);
});

test("쉼 점검 → 다시 낭독: only a new voice, only when paid steps were approved, at most twice; the start confirm counts it", () => {
  const run = read("lib/server/myin-run.ts");
  assert.match(run, /const pauseFixes = stage === "words_ready" \? autoPauseFixes\(record, run, bundle\.data\) : \[\];/);
  assert.match(run, /if \(!run\.paidOk \|\| run\.layout \|\| !voiceFixable\(record, run\) \|\| \(run\.pauseRounds \?\? 0\) >= MYIN_PAUSE_ROUNDS\s/);
  assert.match(run, /export const MYIN_PAUSE_ROUNDS = 2;/);
  assert.match(run, /Date\.parse\(record\.created_at\) < Date\.parse\(MYIN_PAUSE_REVOICE_SINCE\)\) return \[\];/, "only runs cloned with the fixed pause check");
  assert.match(run, /const MYIN_PAUSE_REVOICE_SINCE = "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z";/);
  assert.match(run, /await save\(service, record, "backlog", "words_pending", again\);/, "back to the render PC, which redoes only those sentences");
  assert.match(read("components/myin-v13-panel.tsx"), /\+ 쉼 · 음이탈 점검에 걸린 문단 다시 낭독\(2번까지\)/);
  assert.match(read("components/myin-voice-check.tsx"), /걸린 문장을 저절로 \{data\.pauseRounds\}번 다시 낭독했어요/);
});
