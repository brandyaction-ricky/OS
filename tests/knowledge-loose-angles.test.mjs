import assert from "node:assert/strict";
import test from "node:test";
import { escapeLooseAngles } from "../lib/knowledge-markdown.ts";

test("prose angle brackets read as text; real HTML, comments and code stay", () => {
  assert.equal(escapeLooseAngles("다음 <작업> 순서"), "다음 \\<작업> 순서");
  assert.equal(escapeLooseAngles("<API 키>와 a < b"), "\\<API 키>와 a \\< b");
  assert.equal(escapeLooseAngles("이미 \\<작업>"), "이미 \\<작업>");
  assert.equal(escapeLooseAngles("줄<br>바꿈 <details><summary>요약</summary></details>"), "줄<br />바꿈 <details><summary>요약</summary></details>");
  assert.equal(escapeLooseAngles("<br/> <img src=\"a.png\"> <hr />"), "<br /> <img src=\"a.png\" /> <hr />");
  assert.equal(escapeLooseAngles("<!-- 메모 -->"), "<!-- 메모 -->");
  assert.equal(escapeLooseAngles("<details><summary>원문</summary>\n\n본문\n\n</details>"), "<details>\n<summary>원문</summary>\n\n본문\n\n</details>");
  assert.equal(escapeLooseAngles("코드 `a<b>` 끝 <작업>"), "코드 `a<b>` 끝 \\<작업>");
  assert.equal(escapeLooseAngles("```python\nif n < 3: <작업>\n```\n<작업>"), "```python\nif n < 3: <작업>\n```\n\\<작업>");
});
