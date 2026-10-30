import assert from "node:assert/strict";
import test from "node:test";
import { dictionaryFiles, mergeReported } from "../lib/youtube-process/voice-dictionary.ts";

// 음성 사전 (로건 OS 요청 2026-10-30): the OS keeps his dictionaries; the render PC's report only adds what the OS does not have.
test("the first report is his starting set; later ones come in as 자동 수집 and never bring back what the OS has", () => {
  const at = "2026-10-30T09:00:00Z";
  const first = mergeReported({ readings: [], tests: [] }, { readings: { _설명: "x", ChatGPT: "챗지피티" }, tests: [{ id: "a", text: "문장", bind: ["듣고|보면서"], was: "듣고. 보면서.", from: "피드백" }] }, at);
  assert.equal(first.added, 2);
  assert.deepEqual(first.next.readings.map(row => [row.from, row.to, row.auto]), [["ChatGPT", "챗지피티", false]], "notes (_ keys) stay out; the starting set is checked");
  assert.equal(first.next.tests[0].auto, false);
  const changed = { ...first.next, readings: [{ ...first.next.readings[0], to: "챗 지피티" }] };
  const later = mergeReported(changed, { readings: { ChatGPT: "챗지피티", AI: "에이아이" }, tests: [{ id: "a", text: "문장" }, { id: "b", text: "새 문장", bind: ["열고|싶어지는"] }] }, at);
  assert.equal(later.added, 2);
  assert.deepEqual(later.next.readings.map(row => [row.from, row.to, row.auto]), [["ChatGPT", "챗 지피티", false], ["AI", "에이아이", true]], "a person's change stands");
  assert.deepEqual(later.next.tests.map(row => [row.id, row.auto]), [["a", false], ["b", true]]);
  assert.deepEqual(dictionaryFiles(later.next), { readings: { ChatGPT: "챗 지피티", AI: "에이아이" },
    tests: [{ id: "a", text: "문장", bind: ["듣고|보면서"], was: "듣고. 보면서.", from: "피드백" }, { id: "b", text: "새 문장", bind: ["열고|싶어지는"], was: "", from: "" }] });
  assert.equal(mergeReported(later.next, { readings: { AI: "다른 값" } }, at).added, 0);
});
