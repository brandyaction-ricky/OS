import assert from "node:assert/strict";
import test from "node:test";
import { chunkMarkdown } from "../lib/chunking.mjs";

test("empty markdown creates no chunks", () => {
  assert.deepEqual(chunkMarkdown("  \n"), []);
});

test("markdown headings become citation headings", () => {
  const chunks = chunkMarkdown("# 정책\n첫 번째 규칙입니다.\n\n## 예외\n두 번째 규칙입니다.");
  assert.deepEqual(chunks.map(({ heading, index }) => ({ heading, index })), [
    { heading: "정책", index: 0 },
    { heading: "예외", index: 1 },
  ]);
  assert.match(chunks[1].text, /두 번째 규칙/);
});

test("long sections are bounded and overlap for retrieval continuity", () => {
  const paragraph = "브랜디액션의 검토 기준을 설명하는 문장입니다. ".repeat(160);
  const chunks = chunkMarkdown(`# 검토 기준\n${paragraph}`);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.text.length <= 2025));
  assert.equal(chunks[0].heading, "검토 기준");
  assert.ok(chunks[1].text.startsWith(chunks[0].text.slice(-220)));
});
