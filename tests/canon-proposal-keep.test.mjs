import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { keepOriginalLines } from "../lib/line-diff.ts";

// The original text, and what the rich editor writes back for it untouched: escapes, `*` bullets, `***`, HTML as text.
const original = ["# 제목", "**굵게**한글", "- 하나", "- 둘", "<details>", "<summary>조직 구성 (7명)</summary>", "대표 / 마케터 4명", "</details>", "---", "끝"].join("\n");
const normalized = ["# 제목", "\\*\\*굵게\\*\\*한글", "* 하나", "* 둘", "\\<details>", "\\<summary>조직 구성 (7명)\\</summary>", "대표 / 마케터 4명", "\\</details>", "***", "끝"].join("\n");

test("a change proposal keeps every line the person did not touch as it was written", () => {
  assert.equal(keepOriginalLines(original, normalized, normalized), original, "nothing typed: the original exactly");
  assert.equal(keepOriginalLines(original, original, original), original);
  const edited = keepOriginalLines(original, normalized, normalized.replace("대표 / 마케터 4명", "공동대표 2명 / 마케터 3명"));
  assert.equal(edited, original.replace("대표 / 마케터 4명", "공동대표 2명 / 마케터 3명"), "only the edited line changes");
  assert.equal(keepOriginalLines(original, normalized, `${normalized}\n새 줄`), `${original}\n새 줄`, "an added line, the rest as it was");
  assert.equal(keepOriginalLines(original, normalized, normalized.replace("* 둘\n", "")), original.replace("- 둘\n", ""),
    "deleting one bullet keeps the other bullets' own style");
});

test("a line the editor rewrote and the person edited takes the edited text", () => {
  const out = keepOriginalLines(original, normalized, normalized.replace("\\*\\*굵게\\*\\*한글", "**새 굵게** 한글"));
  assert.match(out, /^\*\*새 굵게\*\* 한글$/m);
  assert.match(out, /^- 하나$/m);
});

test("the proposal editor keeps the original wording and the form survives a reload", () => {
  const canon = readFileSync("components/knowledge/canon.tsx", "utf8");
  assert.match(canon, /onNormalize=\{value=>\{normalized\.current=value;\}\} onChange=\{value=>setContent\(keepOriginalLines\(opened,normalized\.current,value\)\)\}/);
  assert.match(canon, /localStorage\.setItem\(formKey,JSON\.stringify\(\{reason,approver,due,folder,tags,ai\}\)\)/);
  assert.match(canon, /localStorage\.removeItem\(formKey\)/, "cleared once sent");
  const editor = readFileSync("components/knowledge-rich-editor-initialized.tsx", "utf8");
  assert.match(editor, /if \(initialNormalize\) onNormalize\?\.\(preserveKnowledgeWikiLinks\(value\)\);\s*else onChange\(preserveKnowledgeWikiLinks\(value\)\);/);
});
