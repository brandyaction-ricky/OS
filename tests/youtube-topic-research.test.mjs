import assert from "node:assert/strict";
import test from "node:test";
import { noteWithPick, splitRefTitle, topicFormulaRows } from "../lib/youtube-process/topic-research.ts";

// 롱폼 주제 (owner 2026-10-30): the staff AI's 제목 공식 keep to the videos it was given; the OS counts channels; the pick lands in 전달 사항.
const known = new Map([
  ["aaaaaaaaaaa", { title: "퇴근하면 아무것도 못 하는 진짜 이유", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", channel: "채널 A" }],
  ["bbbbbbbbbbb", { title: "쉬어도 피곤한 진짜 이유", url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", channel: "채널 B" }],
  ["ccccccccccc", { title: "주말이 더 피곤한 진짜 이유", url: "https://www.youtube.com/watch?v=ccccccccccc", channel: "채널 B" }],
]);
const topic = (formula, title = "일이 두 개뿐인데 지치는 진짜 이유") => ({ title, insight: "결정의 수가 문제예요", formula, why: "" });

test("a formula's channels are counted from the given videos, the most channels first", () => {
  const { problems, formulas } = topicFormulaRows({
    formulas: [{ formula: "[A]인 [B]", desire: "확인", refs: ["https://youtu.be/ccccccccccc"] },
      { formula: "[흔한 장면]하는 진짜 이유", desire: "내 탓이 아니라는 확인", refs: ["https://www.youtube.com/watch?v=aaaaaaaaaaa", "https://youtu.be/bbbbbbbbbbb", "https://youtu.be/ccccccccccc", "https://youtu.be/bbbbbbbbbbb"] }],
    topics: [topic("[흔한 장면]하는 진짜 이유"), topic("[A]인 [B]", "둘"), topic("[흔한 장면]하는 진짜 이유", "셋")],
  }, known);
  assert.deepEqual(problems, []);
  assert.deepEqual(formulas.map(item => [item.formula, item.channels, item.refs.length]), [["[흔한 장면]하는 진짜 이유", 2, 3], ["[A]인 [B]", 1, 1]]);
});

test("a video outside the lists or a 주제 후보 following no formula is sent back", () => {
  const { problems, formulas } = topicFormulaRows({
    formulas: [{ formula: "[흔한 장면]하는 진짜 이유", desire: "확인", refs: ["https://youtu.be/zzzzzzzzzzz"] }],
    topics: [topic("다른 공식")],
  }, known);
  assert.equal(formulas.length, 0);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /목록에 없는 영상/);
  assert.match(problems[1], /formula가 formulas에 없어요/);
});

test("the picked 주제 후보 replaces an earlier pick in 전달 사항 and keeps the PD's own lines", () => {
  const formula = { formula: "[흔한 장면]하는 진짜 이유", desire: "내 탓이 아니라는 확인", refs: [], channels: 3 };
  const once = noteWithPick("직장인 3년 차 이야기로", topic(formula.formula), formula);
  assert.equal(once, "직장인 3년 차 이야기로\n\n주제 후보: 일이 두 개뿐인데 지치는 진짜 이유\n제목 공식: [흔한 장면]하는 진짜 이유 (채널 3곳)\n시청자가 원하는 것: 내 탓이 아니라는 확인\n통찰: 결정의 수가 문제예요");
  const twice = noteWithPick(once, topic(formula.formula, "쉬는 날에도 머리가 쉬지 않는 진짜 이유"), formula);
  assert.equal(twice.match(/주제 후보: /g).length, 1);
  assert.ok(twice.startsWith("직장인 3년 차 이야기로\n\n주제 후보: 쉬는 날에도"));
  assert.deepEqual(splitRefTitle("영상 · 제목 · 채널 A"), { title: "영상 · 제목", channel: "채널 A" });
});
