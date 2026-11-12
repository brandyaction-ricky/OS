import assert from "node:assert/strict";
import test from "node:test";
import { checkMyinStoryboard, myinReadingNotes } from "../lib/myin-storyboard.ts";

// 읽을 시간 (수정 요청 2026-11-08 2순위): a note when a scene's screen text comes faster than 8 characters a second for as long as the
// scene stays, from the voice; it never stops the storyboard and changes no time.
const words = [[0, 1, "첫"], [1, 2, "장면은"], [2, 3, "짧아요"], [3, 4, "둘째는"], [4, 10, "길게"], [10, 11, "정리"], [11, 20, "끝"]];
const scenes = [
  { type: "statement", at: "첫 장면은", title: [[["이 장면에는 글자가 아주 많이 들어 있어서", "첫 장면은"]], [["세 초 안에 다 읽기 어려워요", "짧아요", "accent"]]] },
  { type: "statement", at: "둘째는", title: [[["여섯 초면 넉넉해요", "둘째는"]]], _plan: "화면에 안 나오는 메모가 아주 길게 적혀 있어도 세지 않아요 화면에 안 나오는 메모" },
  { type: "summary", at: "정리", title: "한 장 정리", points: ["캡처용이라 글자가 많아도 괜찮은 장면이에요", "두 번째 줄도 길어요 길어요 길어요"] },
];

test("only screen words count (no cues, notes, file names), and only past 8 a second for 15 characters or more", () => {
  const notes = myinReadingNotes(scenes, words, 20);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /^1번 장면 \(0:00\) · 화면 글자 \d+자가 3\.0초 동안 — 1초에 \d+자/);
});

test("한 장 정리, the end card and a 0-second opening placeholder are not read line by line", () => {
  assert.deepEqual(myinReadingNotes([{ type: "opening", at_time: 0, title: "아주 긴 제목이 들어 있는 영 초 오프닝 자리표시" }, { type: "statement", at_time: 0, title: "짧음" }], words, 20), []);
  assert.deepEqual(myinReadingNotes([{ type: "summary", at: "첫", points: ["아주 긴 정리 문장이 하나 둘 셋 넷 다섯 여섯 일곱"] }], [[0, 1, "첫"]], 1.5), []);
});

test("the storyboard check hands the notes back beside its issues; they are never issues", () => {
  const checked = checkMyinStoryboard({ scenes: [] }, words);
  assert.deepEqual(checked.reading, []);
});
