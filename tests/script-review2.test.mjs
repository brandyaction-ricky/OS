import assert from "node:assert/strict";
import test from "node:test";
import { numberedScript, parseReview2, review2Prompt, REVIEW2_SCHEMA } from "../lib/youtube-script-review2.ts";
import { scriptKey } from "../lib/youtube-process/stages.ts";
import { tokenEstimate, modelName } from "../lib/cost.ts";

const script = "# 제목 줄\n\n## 도입\n첫 문단이에요.\n\n둘째 문단이에요.\n\n## 본론\n셋째 문단이에요.\n\n## 출처\n- 문서 하나\n";

test("the judge sees the spoken paragraphs numbered from 1, with the section headings", () => {
  const { text, paragraphs } = numberedScript(script);
  assert.equal(paragraphs, 3);
  assert.equal(text, "## 도입\n\n[1] 첫 문단이에요.\n\n[2] 둘째 문단이에요.\n\n## 본론\n\n[3] 셋째 문단이에요.");
});

// 공정 정본 §12-3: the 별도 판정 gets the 원고 and the judging canons only — nothing from the writing (notes, design, earlier verdicts).
test("the request is the rules and two canons first, then only the title, thumbnail copy and 원고", () => {
  const { prefix, prompt, paragraphs } = review2Prompt({ review: "검수 정본 본문", tone: "말투 정본 본문" }, { title: "제목 A", thumbCopy: "카피 A", script });
  assert.equal(paragraphs, 3);
  assert.ok(prefix.includes("별도 판정") && prefix.includes("=== [원고 검수 정본] ===\n검수 정본 본문") && prefix.includes("=== [원고 말투 정본] ===\n말투 정본 본문"));
  assert.ok(prompt.startsWith("=== 이 영상 ===\n제목: 제목 A\n썸네일 카피: 카피 A"));
  assert.ok(prompt.includes("[3] 셋째 문단이에요.") && !prompt.includes("문서 하나"), "the 출처 section is not spoken");
  assert.deepEqual(REVIEW2_SCHEMA.properties.gates.items.properties.gate.enum, [2, 3, 4, 5, 6]);
});

const gate = (n, pass, items = []) => ({ gate: n, pass, items });
const item = (paragraph, grade = "상") => ({ paragraph, quote: "원문", grade, reason: "장면이 없어요", fix: "한 문장" });

test("a judgement counts only with every gate 2~6 once; its result passes only when every gate does", () => {
  const ok = parseReview2(JSON.stringify({ gates: [gate(2, true), gate(3, true), gate(4, true), gate(5, true), gate(6, true, [item(1, "하")])], doubts: ["틀렸을 만한 것"] }), 3);
  assert.equal(ok.pass, true);
  assert.equal(ok.gates.length, 5);
  const bad = parseReview2(JSON.stringify({ gates: [gate(6, false, [item(2), item(9)]), gate(2, true), gate(3, true), gate(4, true), gate(5, true)], doubts: [] }), 3);
  assert.equal(bad.pass, false);
  assert.deepEqual(bad.gates.map((row) => row.gate), [2, 3, 4, 5, 6], "kept in gate order");
  assert.deepEqual(bad.gates[4].items.map((row) => row.paragraph), [2], "a paragraph the 원고 does not have is dropped");
  assert.equal(parseReview2(JSON.stringify({ gates: [gate(2, true), gate(3, true), gate(4, true), gate(5, true)], doubts: [] }), 3), null, "a missing gate");
  assert.equal(parseReview2(JSON.stringify({ gates: [gate(2, true), gate(2, true), gate(3, true), gate(4, true), gate(5, true), gate(6, true)], doubts: [] }), 3), null, "a gate twice");
  assert.equal(parseReview2("not json", 3), null);
});

test("the 원고 fingerprint ignores line endings and outer blanks and changes with the text", () => {
  assert.equal(scriptKey("가나다\r\n라"), scriptKey("  가나다\n라\n"));
  assert.notEqual(scriptKey("가나다"), scriptKey("가나라"));
  assert.match(scriptKey(""), /^[0-9a-f]{8}$/);
});

// developers.openai.com/api/docs/models/gpt-6-astra (checked 2026-10-29): $10 in / $50 out per 1M tokens.
test("the [다시 검수] popup prices GPT-6 Astra", () => {
  assert.equal(tokenEstimate("gpt-6-astra", 1_000_000, 0), 10 * 1400);
  assert.equal(tokenEstimate("gpt-6-astra", 0, 1_000_000), 50 * 1400);
  assert.equal(modelName("gpt-6-astra"), "GPT-6 Astra");
});
