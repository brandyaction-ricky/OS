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
  assert.match(canon, /onNormalize=\{value=>\{normalized\.current=value;\}\} onChange=\{value=>setContent\(keepOriginalLines\(opened\.current,normalized\.current,value\)\)\}/);
  assert.match(canon, /localStorage\.setItem\(formKey,JSON\.stringify\(\{reason,approver,due,folder,tags,ai\}\)\)/);
  assert.match(canon, /localStorage\.removeItem\(formKey\)/, "cleared once sent");
  const editor = readFileSync("components/knowledge-rich-editor-initialized.tsx", "utf8");
  assert.match(editor, /if \(initialNormalize\) onNormalize\?\.\(preserveKnowledgeWikiLinks\(value\)\);\s*else onChange\(preserveKnowledgeWikiLinks\(value\)\);/);
});

// 2026-11-12 df1b5d54: what the rich editor writes for a table after one cell changed — every row re-padded, `~` escaped,
// a blank line before the table.
const table = ["## 제품 라인업", "| 상품 | 가격 | 역할 |", "|---|---|---|", "| 자체 진단 보고서 | 59,000원 | BM 진입 깔때기 (월 ~1,300만 검증) |", "| 해설 영상 | 39,000원 | 업셀 |", "", "끝"].join("\n");
const tableNormalized = ["## 제품 라인업", "", "| 상품        | 가격      | 역할                      |", "| --------- | ------- | ----------------------- |", "| 자체 진단 보고서 | 59,000원 | BM 진입 깔때기 (월 \\~1,300만 검증) |", "| 해설 영상     | 39,000원 | 업셀                      |", "", "끝"].join("\n");
const tableEdited = ["## 제품 라인업", "", "| 상품        | 가격      | 역할                        |", "| --------- | ------- | ------------------------- |", "| 자체 진단 보고서 | 68,000원 | BM 진입 깔때기 (월 \\~1,300만 검증)   |", "| 해설 영상     | 39,000원 | 진단 후 업셀                   |", "", "끝"].join("\n");

test("editing table cells changes only those cells; spacing, escapes and blank lines stay as written", () => {
  assert.equal(keepOriginalLines(table, tableNormalized, tableEdited),
    table.replace("59,000원", "68,000원").replace("| 업셀 |", "| 진단 후 업셀 |"));
  const added = keepOriginalLines(table, tableNormalized, tableNormalized.replace("| 해설 영상     | 39,000원 | 업셀                      |", "$&\n| 핵심 보고서 | 19,800원 | 새 상품 |"));
  assert.equal(added, table.replace("| 해설 영상 | 39,000원 | 업셀 |", "$&\n| 핵심 보고서 | 19,800원 | 새 상품 |"), "a new row, no padding");
});

test("a workspace refresh does not reopen the proposal editor; the draft can be discarded; Markdown can be edited as written", () => {
  const canon = readFileSync("components/knowledge/canon.tsx", "utf8");
  assert.match(canon, /setDoc\(current=>current\?\.id===id\?current:null\)/, "autosave and window focus refresh the workspace: keep the loaded page");
  assert.doesNotMatch(canon, /let live=true;setDoc\(null\)/);
  assert.match(canon, /command\(\{action:"document\.discard",id:doc\.id\}\);lastSaved\.current="";setTitle\(doc\.title\);setContent\(doc\.content_md\);restart\(doc\.content_md\)/);
  assert.match(canon, />초안 버리기</);
  assert.match(canon, /aria-label="제안 본문 마크다운"[^>]*value=\{content\} onChange=\{e=>setContent\(e\.target\.value\)\}/);
});
