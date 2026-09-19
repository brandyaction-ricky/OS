import assert from "node:assert/strict";
import test from "node:test";
import { knowledgeFolderOptions, normalizeKnowledgeFolder, renameKnowledgeFolderPath } from "../lib/knowledge-folders.ts";

test("knowledge folder paths are normalized and unsafe paths are rejected", () => {
  assert.equal(normalizeKnowledgeFolder(" /운영//회의/ "), "운영/회의");
  assert.equal(normalizeKnowledgeFolder("운영\\회의"), "운영/회의");
  for (const path of ["", "/", ".", "..", "운영/../비밀", "운영\n회의", "a".repeat(161)]) {
    assert.throws(() => normalizeKnowledgeFolder(path));
  }
});

test("folder options include parent categories once", () => {
  assert.deepEqual(knowledgeFolderOptions(["운영/회의/주간", "운영/회의", "콘텐츠"]), ["운영", "운영/회의", "운영/회의/주간", "콘텐츠"]);
});

test("renaming a folder preserves nested document locations", () => {
  assert.equal(renameKnowledgeFolderPath("운영/회의/주간", "운영/회의", "회사/회의록"), "회사/회의록/주간");
  assert.equal(renameKnowledgeFolderPath("운영/지표", "운영/회의", "회사/회의록"), "운영/지표");
});
