import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("knowledge images remain private, bounded and attached without rewriting document bodies", async () => {
  const [migration, route, workspace, helper] = await Promise.all([
    read("supabase/migrations/20260920014323_knowledge_document_assets.sql"),
    read("app/api/v1/knowledge-assets/route.ts"),
    read("components/knowledge-workspace.tsx"),
    read("lib/knowledge-assets.ts"),
  ]);
  assert.match(migration, /'os-knowledge-assets'.*false, 15728640/s);
  assert.match(migration, /unique \(document_id, reference_key\)/);
  assert.match(migration, /os_can_read_document\(document_id\)/);
  assert.doesNotMatch(migration, /drop table|truncate\s/i);
  assert.match(route, /createSignedUploadUrl/);
  assert.match(route, /createSignedUrl/);
  assert.match(route, /document\.owner_id !== actor\.id/);
  assert.match(helper, /!\\\[\\\[\(\[\^\\\]\]\+\)\\\]\\\]/);
  assert.match(workspace, /기존 문서 이미지 일괄 연결/);
  assert.match(workspace, /갤러리 보기/);
  assert.match(workspace, /다시 연결/);
});
