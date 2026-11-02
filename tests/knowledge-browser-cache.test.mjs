import assert from "node:assert/strict";
import test from "node:test";
import { mergeWorkspaceDocuments } from "../lib/knowledge/browser-cache.ts";

// 회사 문서 목록 브라우저 저장 (2026-11-02): the kept list plus the server's changes.
const doc = (id, title, version = 1) => ({ id, title, current_version: version, content_md: "" });
test("changed documents replace kept ones, hidden ones drop out, the server's order wins", () => {
  const kept = [doc("a", "가"), doc("b", "나"), doc("c", "다")];
  const merged = mergeWorkspaceDocuments(kept, [doc("b", "나 고침", 2)], ["c", "b"]);
  assert.deepEqual(merged.map(d => [d.id, d.title]), [["c", "다"], ["b", "나 고침"]]);
});
test("a visible document the browser never had means reading everything", () => {
  assert.equal(mergeWorkspaceDocuments([doc("a", "가")], [], ["a", "z"]), null);
  assert.deepEqual(mergeWorkspaceDocuments([doc("a", "가")], [doc("z", "새 글")], ["a", "z"]).map(d => d.id), ["a", "z"]);
});
