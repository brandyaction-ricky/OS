import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { queueText } from "../lib/myin-voice-queue.ts";

// 대기 순서 (로건 요청 94ba5545, 2026-11-17): a voice waiting for the render PC says what it is on and about when this one starts.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("the wait names what the render PC is on, the voices ahead and about when this one starts", () => {
  assert.equal(queueText({ pcOn: true, ahead: 1, minutes: 58, now: { title: "눈치 많이 보는 사람이 사실 잘하는 일", stage: "words_pending", left: 37 } }),
    "영상 만드는 컴퓨터가 지금 「눈치 많이 보는 사람이 사실 잘하는…」 음성을 만드는 중(약 35분 남음) · 앞에 음성 1편 · 약 60분 뒤 시작");
  assert.equal(queueText({ pcOn: true, ahead: 0, minutes: 4, now: { title: "", stage: "image_ad", left: 4 } }), "영상 만드는 컴퓨터가 지금 다른 작업을 하는 중(약 4분 남음) · 약 4분 뒤 시작");
  assert.equal(queueText({ pcOn: true, ahead: 0, minutes: 0, now: null }), "곧 시작");
  assert.equal(queueText({ pcOn: false, ahead: 2, minutes: 0, now: null }), "영상 만드는 컴퓨터가 꺼져 있어요 · 켜지면 앞의 음성 2편 다음에 만들어요");
});

test("the server counts the job on now and the voices queued before this one; a voice counts only paragraphs it must make", () => {
  const run = read("lib/server/myin-run.ts");
  assert.match(run, /if \(record\.status !== "backlog" \|\| record\.stage !== "words_pending"\) return null;/);
  assert.match(run, /item\.row\.stage === "words_pending" && item\.row\.status === "backlog"\s*&& item\.row\.created_at < record\.created_at/, "the render PC takes the oldest first");
  assert.match(run, /run\.paragraphs\.filter\(\(p\) => !kept\.has\(p\.textHash\)\)\.length/, "paragraphs an earlier voice has are kept (#606)");
  assert.match(run, /voiceQueue: await voiceQueue\(createServiceSupabase\(\), record\)\.catch\(\(\) => null\)/, "a failed estimate never breaks the run view");
  assert.match(read("components/myin-v13-panel.tsx"), /run\.voiceQueue \? queueText\(run\.voiceQueue\) : `\$\{maker\(run\)\} 차례를 기다리는 중`/);
});
