import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { myinTextPairs } from "../lib/myin-storyboard.ts";

// 11-12: a question-typing scene with "q": "그날, 뭐가 달랐다면?" (words, not {text, cue}) stopped the engine at ③ three times.
const examples = new Map([["lib_question_typing", { type: "lib_question_typing", theme: "myin", q: { text: "예시", cue: "(대본 문구)" }, button: "검색" }]]);

test("a {text, cue} slot written as words is wrapped as the 도식 창고 example has it, cued at the scene's start", () => {
  const story = { scenes: [{ type: "opening" }, { type: "lib_question_typing", at: "비슷한 경험이", cue: "비슷한 경험이", q: "그날, 뭐가 달랐다면?", button: "떠올리기" }] };
  assert.deepEqual(myinTextPairs(story, examples), [2]);
  assert.deepEqual(story.scenes[1].q, { text: "그날, 뭐가 달랐다면?", cue: "비슷한 경험이" });
  assert.equal(story.scenes[1].button, "떠올리기", "plain-word slots stay words");
  // Right already, or a type without an example: nothing changes.
  assert.deepEqual(myinTextPairs(story, examples), []);
  assert.deepEqual(myinTextPairs({ scenes: [{ type: "lib_other", q: "말" }] }, examples), []);
});

test("every render job gets the fixed story, and the music match compares against it", () => {
  const run = readFileSync(new URL("../lib/server/myin-run.ts", import.meta.url), "utf8");
  assert.equal(run.match(/storyboard: await renderStory\(/g)?.length, 4, "구독 대사 · 미리보기 · 점검 시트 다시 그리기 · 완성");
  assert.doesNotMatch(run, /storyboard: myinDriftPairs\(/);
  assert.match(run, /myinOnlySoundChanged\(bundle\.storyboard, await renderStory\(await storyboardJson\(service, run\)\)\)/);
});
