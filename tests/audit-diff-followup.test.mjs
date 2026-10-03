import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("audit history includes versioned document edits and server-side date paging", async () => {
  const [route, ui, sql] = await Promise.all([
    read("app/api/v1/audit/route.ts"), read("components/audit-workspace.tsx"), read("supabase/migrations/20261003190000_audit_version_time_index.sql"),
  ]);
  assert.match(route, /versionQuery = service\.from\("os_document_versions"\)/);
  assert.match(route, /versionQuery = versionQuery\.gte\("created_at", from\)/);
  assert.match(route, /versionQuery = versionQuery\.lt\("created_at", to\)/);
  assert.match(route, /id: `version:\$\{version\.document_id\}:\$\{version\.version_no\}`/);
  assert.match(route, /allowedDocuments = await readableKnowledgePages\(actor, documents\.data/);
  assert.match(route, /versionResult\.data \?\? \[\]\)\.filter\(\(version\) => allowedDocuments\.has\(version\.document_id\)\)/);
  assert.match(ui, /nextCursor/);
  assert.match(ui, /groupAuditHistory/);
  assert.match(sql, /os_document_versions_created_at_idx/);
});

test("audit diff rechecks access, redacts metadata values and restores through existing APIs", async () => {
  const [route, ui] = await Promise.all([read("app/api/v1/audit/diff/route.ts"), read("components/audit-diff-panel.tsx")]);
  assert.match(route, /actor\.supabase\.from\("os_records"\)/);
  assert.match(route, /readableKnowledgePages\(actor, \[document\]\)/);
  assert.match(route, /metadata.*보안상 값 숨김/);
  assert.match(ui, /diffMarkdownLines/);
  assert.match(ui, /!reason\.trim\(\)/);
  assert.match(ui, /\/api\/v1\/documents\/\$\{encodeURIComponent\(diff\.subjectId\)\}\/versions/);
  assert.match(ui, /\/api\/v1\/records\/\$\{encodeURIComponent\(diff\.subjectId\)\}\/versions/);
});
