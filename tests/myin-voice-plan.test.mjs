import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { heardOf, planVoiceFix } from "../lib/myin-voice-plan.ts";

// 유쓰 요청 0dfd9a37 보완 ① (2026-11-03): before a voice fix, the sentences it makes again — found the way Logan's voice_fix finds them —
// memos at one sentence made and paid once, the ones the OS cannot place said so, and how many sentences stay.
const sentences = [
  { at: 0, text: "안녕하세요, 오늘은 재능 이야기를 해 볼게요." },
  { at: 4.2, text: "사람과 분위기는 생각보다 많이 닮았어요." },
  { at: 9.8, text: "그래서 하루를 시간 순서로 다시 봐요." },
];

test("a memo finds its sentence by the words heard, then by the time", () => {
  assert.equal(heardOf("00:05 사람과. 분위기는 (어색) → 끊김"), "사람과. 분위기는 ");
  const plan = planVoiceFix([{ memo: "00:01 사람과. 분위기는. 끊김" }, { memo: "00:11 끊김" }], sentences);
  assert.deepEqual(plan.targets.map((t) => t.index), [1, 2], "the words heard win over a wrong time; a bare time finds the sentence it falls in");
  assert.equal(plan.keep, 1);
  assert.deepEqual(plan.unplaced, []);
});

test("memos at the same sentence are one fix, keeping the 읽는 글 any of them gave", () => {
  const plan = planVoiceFix([{ memo: "00:05 사람과 분위기는" }, { memo: "00:06 어색", say: "사람이랑 분위기는 생각보다 많이 닮았어요." }], sentences);
  assert.equal(plan.fixes.length, 1, "made and paid once");
  assert.deepEqual(plan.fixes[0], { memo: "00:05 사람과 분위기는", say: "사람이랑 분위기는 생각보다 많이 닮았어요." });
  assert.equal(plan.targets[0].memos.length, 2);
});

test("two different 읽는 글 for one sentence are a conflict; a video-time memo is left to the render PC", () => {
  assert.equal(planVoiceFix([{ memo: "00:05 사람과 분위기는", say: "가" }, { memo: "00:05 사람과 분위기", say: "나" }], sentences).conflicts.length, 1);
  const video = planVoiceFix([{ memo: "07:41 발음이 이상해요", video: true }, { memo: "07:41 여기도", video: true }], sentences);
  assert.deepEqual([video.targets.length, video.unplaced.length, video.fixes.length], [0, 1, 1], "feedback at the same second of the video is one fix");
  assert.equal(planVoiceFix([{ memo: "00:05 끊김" }], []).unplaced.length, 1, "a voice made before voice_audit: nothing to place here");
});

test("the server sends the merged fixes and refuses a conflict; the screens show the plan before paying", async () => {
  const run = await readFile(new URL("../lib/server/myin-run.ts", import.meta.url), "utf8");
  const request = run.slice(run.indexOf("export async function requestMyinVoiceFix"), run.indexOf("/** 「음성 확인 완료」"));
  assert.match(request, /const plan = planVoiceFix\(memos, await voiceSentences\(service, run\)\);[\s\S]*MYIN_VOICE_FIX_CONFLICT[\s\S]*const fixes = plan\.fixes;/);
  const check = await readFile(new URL("../components/myin-voice-check.tsx", import.meta.url), "utf8");
  assert.match(check, /<VoiceFixScope plan=\{plan\} \/>/);
  assert.match(check, /askCost\(planText\(plan\), plan\.fixes\.length\)/, "the cost is from the sentences found, not a guess per memo");
  assert.match(await readFile(new URL("../components/youtube-process-voice-feedback.tsx", import.meta.url), "utf8"), /askVoicePlan\(token, run\.id, fixes\)/);
});
