import assert from "node:assert/strict";
import test from "node:test";
import { checkShortStoryboard, shortLineWidth } from "../lib/myin-short-storyboard.ts";

// 숏폼 기획표 (2026-10-28): opening (big type) and vertical lib_ diagrams only, the confirmed 헤드 카피 on the first screen, lines inside
// the 1080 px frame and diagram slots inside their letter limits.
const speech = "둘 다 원할 땐 뭘 골라야 할까요? 이번 주말에도 친구를 만나고 싶어요. 가고 싶고 쉬고 싶은 마음이 같이 있는 거죠.";
const words = speech.split(" ").map((word, i) => [i * 0.4, i * 0.4 + 0.35, word]);
const duration = words.at(-1)[1];
const diagrams = [{ type: "lib_venn2", name: "두 원", slots: "a · b ≤ 6자, mid ≤ 4자", spec: { kind: "object", fields: {
  a: { kind: "object", fields: { text: { kind: "text", max: 6 } } }, b: { kind: "object", fields: { text: { kind: "text", max: 6 } } },
  mid: { kind: "object", fields: { text: { kind: "text", max: 4 } } } } } }];
const input = { words, speech, headCopy: "둘 다 원하면 뭘 고르지", durationSeconds: duration, diagrams };
const good = () => ({ title: "만나고 싶은데, 쉬고도 싶다면", end: duration + 1, reel: { dur: 6 }, scenes: [
  { type: "opening", at: "둘 다 원할 땐", acts: [
    { panel: "none", size: 110, lines: [[{ text: "둘 다 원하면" }], [{ text: "뭘 고르지", accent: true }]] },
    { cue: "이번 주말에도", panel: "none", size: 100, lines: [[{ text: "이번 주말에도", cue: "이번 주말에도" }], [{ text: "친구를 만나고 싶어요", cue: "친구를" }]] }] },
  { type: "lib_venn2", at: "가고 싶고", a: { text: "만나고 싶다", cue: "가고 싶고" }, b: { text: "쉬고 싶다", cue: "쉬고 싶은" }, mid: { text: "둘 다", cue: "같이 있는" } },
] });

test("a short storyboard passes and gets the shared defaults", () => {
  const checked = checkShortStoryboard(good(), input);
  assert.deepEqual(checked.issues, []);
  assert.deepEqual(checked.story.cta, []);
  assert.equal("reel" in checked.story, false);
  assert.equal(checked.story.scenes[0].bg, "white");
  assert.deepEqual(checked.story.scenes[0].acts[0].cam, { push: 0.006, drift: [0, 0], punch: 0 });
  assert.equal(checked.story.scenes[0].acts[1].size, 100);
});

test("the first screen is the confirmed head copy", () => {
  const story = good();
  story.scenes[0].acts[0].lines = [[{ text: "다른 문구" }]];
  assert.match(checkShortStoryboard(story, input).issues.join(" "), /헤드 카피 「둘 다 원하면 뭘 고르지」 그대로/);
  story.scenes.reverse();
  assert.match(checkShortStoryboard(story, input).issues.join(" "), /첫 장면은 opening/);
});

test("only diagrams with a vertical layout, inside their letter limits", () => {
  const story = good();
  story.scenes[1].mid.text = "둘 다 원함요";
  assert.match(checkShortStoryboard(story, input).issues.join(" "), /mid\.text 「둘 다 원함요」은 4자 이하/);
  story.scenes[1].type = "iceberg";
  assert.match(checkShortStoryboard(story, input).issues.join(" "), /"iceberg"는 세로로 그릴 수 없어요/);
});

test("a big line wider than the frame, a missing cue and a sentence with no text are sent back", () => {
  assert.ok(shortLineWidth("이제는 만날지 말지에서", 90) < 800);   // A1: 777 px measured
  const wide = good();
  wide.scenes[0].acts[1].size = 160;
  assert.match(checkShortStoryboard(wide, input).issues.join(" "), /화면보다 넓어요/);
  const cue = good();
  cue.scenes[1].b.cue = "혼자 쉬는";
  assert.match(checkShortStoryboard(cue, input).issues.join(" "), /문구 못 찾음: 혼자 쉬는/);
  const bare = good();
  bare.scenes[0].acts.pop();
  assert.match(checkShortStoryboard(bare, input).issues.join(" "), /「이번 주말에도 친구를 만나고 싶어요\.」 문장에 화면 글자가 없어요 — 첫 장면에는 자막이 없으니/);
  const late = good();
  late.end = duration + 9;
  assert.match(checkShortStoryboard(late, input).issues.join(" "), /end는 마지막 말이 끝난 뒤 0~3초/);
});
