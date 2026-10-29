import assert from "node:assert/strict";
import test from "node:test";
import { checkShortStoryboard, shortDiagramList, shortLineWidth } from "../lib/myin-short-storyboard.ts";

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
  // owner 2026-10-29: big type that sits still loses viewers — every act slams in and the camera punches and pushes (shared by the acts).
  assert.deepEqual(checked.story.scenes[0].acts[0].cam, { push: 0.03, drift: [0, 0], punch: 0.07 });
  assert.equal(checked.story.scenes[0].acts[1].slam, true);
  assert.equal(checked.story.scenes[0].acts[1].size, 100);
  // Logan's drawer reads act.t and every piece's t: the head-copy act starts with the scene, untimed pieces with their act.
  assert.equal(checked.story.scenes[0].acts[0].cue, "둘 다 원할 땐");
  assert.deepEqual(checked.story.scenes[0].acts[0].lines[1][0], { text: "뭘 고르지", accent: true, cue: "둘 다 원할 땐" });
  const later = good();
  later.scenes[0].acts[0].lines[1][0].cue = "뭘 골라야";
  assert.equal(checkShortStoryboard(later, input).story.scenes[0].acts[0].cue, "둘 다 원할 땐");
  const slots = good();
  delete slots.scenes[1].mid.cue;
  assert.deepEqual(checkShortStoryboard(slots, input).story.scenes[1].mid, { text: "둘 다", cue: "가고 싶고" });
  const untimed = good();
  delete untimed.scenes[0].acts[1].cue;
  untimed.scenes[0].acts[1].lines = [["이번 주말에도"], ["친구를 만나고 싶어요"]];
  assert.match(checkShortStoryboard(untimed, input).issues.join(" "), /2번째 막에 cue\(그 막이 시작되는 말\)가 없어요/);
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
  const many = { type: "lib_list", name: "목록", slots: "1~2개", spec: { kind: "object", fields: { items: { kind: "array", min: 1, max: 2, item: { kind: "object", fields: { text: { kind: "text", max: 6 } } } } } } };
  const listed = good();
  listed.scenes[1] = { type: "lib_list", at: "가고 싶고", items: [{ text: "하나" }, { text: "둘" }, { text: "셋" }] };
  assert.match(checkShortStoryboard(listed, { ...input, diagrams: [many] }).issues.join(" "), /items는 1~2개예요\(지금 3개\)/);
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

test("the card lists the letter limits the OS checks before the catalog's note", () => {
  const list = shortDiagramList([...diagrams, { type: "lib_strike_list", name: "취소선목록", slots: "항목 2~4개, 각 ≤ 12자, 마지막 keep", spec: { kind: "object", fields: {
    items: { kind: "array", min: 1, max: 4, item: { kind: "object", fields: { text: { kind: "text", max: 9 }, keep: { kind: "boolean" } } } } } } }]);
  assert.equal(list, "- lib_venn2 (두 원): a.text ≤ 6자 · b.text ≤ 6자 · mid.text ≤ 4자 — a · b ≤ 6자, mid ≤ 4자\n"
    + "- lib_strike_list (취소선목록): items 1~4개 · items.text ≤ 9자 — 항목 2~4개, 각 ≤ 12자, 마지막 keep");
});

// owner 2026-10-29: text-only screens lose viewers — big type on the first and the last screen and one emphasis line between, at least
// 80 % diagrams.
test("big type sits on the first and the last screen and one emphasis line, and a person can come in as a persona card", () => {
  const line = (text) => ({ panel: "none", size: 100, lines: [[{ text }]] });
  const middle = good();
  middle.scenes[0].acts.pop();
  middle.scenes.splice(1, 0, { type: "opening", at: "이번 주말에도", acts: [line("이번 주말에도")] });
  assert.deepEqual(checkShortStoryboard(middle, input).issues, []);
  middle.scenes[1].acts.push({ ...line("친구를 만나고 싶어요"), cue: "친구를" });
  assert.match(checkShortStoryboard(middle, input).issues.join(" "), /\[장면 2\] 가운데 큰 글자\(opening\)는 꼭 강조할 한 문장에 한 번\(막 하나\)만/);
  middle.scenes[1].acts.pop();
  middle.scenes.splice(2, 0, { type: "opening", at: "친구를", acts: [line("친구를 만나고 싶어요")] });
  assert.match(checkShortStoryboard(middle, input).issues.join(" "), /\[장면 3\] 가운데 큰 글자/);
  assert.doesNotMatch(checkShortStoryboard(middle, input).issues.join(" "), /\[장면 2\] 가운데 큰 글자/);
  const last = good();
  last.scenes.push({ type: "opening", at: "같이 있는", acts: [{ panel: "none", size: 100, lines: [[{ text: "같이 있는 거죠" }]] }] });
  assert.doesNotMatch(checkShortStoryboard(last, input).issues.join(" "), /큰 글자\(opening\)는/);
  const person = good();
  person.scenes[0].acts.pop();
  person.scenes.splice(1, 0, { type: "persona", at: "이번 주말에도", people: [{ name: "민지 씨", desc: "3년 차 마케터", prop: "hair" }] });
  const checked = checkShortStoryboard(person, input);
  assert.deepEqual(checked.issues, []);
  assert.deepEqual(checked.story.scenes[1].people[0], { name: "민지 씨", desc: "3년 차 마케터", prop: "hair", cue: "이번 주말에도" });
  person.scenes[1].people = [{ name: "민지 씨는 마케터" }];
  assert.match(checkShortStoryboard(person, input).issues.join(" "), /persona는 people\(사람마다 name · desc\)/);
  assert.match(checkShortStoryboard(person, input).issues.join(" "), /people\.0\.name 「민지 씨는 마케터」은 6자 이하/);
});

test("a short of 20 s or more keeps diagrams on at least 80 % of the narration", () => {
  const long = "둘 다 원할 땐? 이번 주말에도 친구를 만나고 싶어요. 가고 싶고 쉬고 싶은 마음이 같이 있는 거죠. 그런데 몸은 하나라서 토요일 오후에는 늘 하나만 고르게 되고 만나면 쉬지 못하고 쉬면 만나지 못하니까 마음 한쪽이 늘 비어 있어요.";
  const longWords = long.split(" ").map((word, i) => [i * 0.7, i * 0.7 + 0.6, word]);
  const longInput = { ...input, words: longWords, speech: long, durationSeconds: longWords.at(-1)[1] };
  const opening = (acts) => ({ type: "opening", at: "둘 다 원할 땐", acts });
  const head = { panel: "none", size: 110, lines: [[{ text: "둘 다 원하면" }], [{ text: "뭘 고르지", accent: true }]] };
  const venn = (at) => ({ type: "lib_venn2", at, a: { text: "만나고 싶다", cue: "가고 싶고" }, b: { text: "쉬고 싶다", cue: "쉬고 싶은" }, mid: { text: "둘 다", cue: "같이 있는" } });
  const quick = { title: "t", end: longInput.durationSeconds + 1, scenes: [opening([head]), venn("이번 주말에도")] };
  assert.deepEqual(checkShortStoryboard(quick, longInput).issues, []);
  assert.ok(checkShortStoryboard(quick, longInput).share > 0.85);
  const slow = { ...quick, scenes: [opening([head, { cue: "이번 주말에도", panel: "none", size: 100, lines: [[{ text: "이번 주말에도", cue: "이번 주말에도" }], [{ text: "친구를 만나고 싶어요", cue: "친구를" }]] }]), venn("가고 싶고")] };
  assert.match(checkShortStoryboard(slow, longInput).issues.join(" "), /도식 화면이 7\d%예요\. 80% 이상이 되게/);
});
