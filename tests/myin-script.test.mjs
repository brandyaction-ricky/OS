import assert from "node:assert/strict";
import test from "node:test";
import { myinCleanScript, myinRunMatchesScript, myinScriptMarkdown } from "../lib/myin-script.ts";

// The render PC runs Logan's stage_voice.py unchanged; the OS must send Fish exactly the paragraphs it speaks.
test("an OS manuscript becomes Logan's script: head comments dropped, title and sections not spoken, 출처 cut", () => {
  const manuscript = ["# 제목은 읽지 않는다", "<!-- 축: 하나 | 역할: 유입형 -->", "<!-- 출처: 2 → 문서 -->", "", "## 도입", "",
    "첫 문단입니다.", "", "[추론] 메모는 읽지 않는다", "", "## 두 번째", "", "둘째 문단, 쉼표도 그대로.", "https://example.com",
    "", "## 출처", "", "출처 아래는 버린다."].join("\n");
  const md = myinScriptMarkdown(manuscript, "");
  assert.ok(!md.includes("<!--"));
  const { spoken, sections, paras } = myinCleanScript(md);
  assert.deepEqual(spoken, ["첫 문단입니다.", "둘째 문단, 쉼표도 그대로."]);
  assert.deepEqual(sections, ["도입", "두 번째"]);
  assert.deepEqual(paras, ["#SECTION 도입", "첫 문단입니다.", "#SECTION 두 번째", "둘째 문단, 쉼표도 그대로."]);
});

test("narration without a manuscript is one paragraph per line", () => {
  const md = myinScriptMarkdown(null, "가 문단\n이어진 줄\n\n나 문단");
  assert.deepEqual(myinCleanScript(md).spoken, ["가 문단 이어진 줄", "나 문단"]);
});

test("a v13 run stops matching once the 원고 changes: key, markdown, or any spoken paragraph", () => {
  const run = { inputKey: "k1", scriptMarkdownHash: "m1", paragraphs: [{ textHash: "a" }, { textHash: "b" }] };
  const now = { inputKey: "k1", markdownHash: "m1", spokenHashes: ["a", "b"] };
  assert.equal(myinRunMatchesScript(run, now), true);
  assert.equal(myinRunMatchesScript(run, { ...now, inputKey: "k2" }), false);
  assert.equal(myinRunMatchesScript(run, { ...now, markdownHash: "m2" }), false);
  assert.equal(myinRunMatchesScript(run, { ...now, spokenHashes: ["a", "c"] }), false);
  assert.equal(myinRunMatchesScript(run, { ...now, spokenHashes: ["a", "b", "c"] }), false);
});
