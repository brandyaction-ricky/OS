import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("steward migration is gated and existing documents are retained", async () => {
  const file = "20261003183000_document_steward.sql";
  const [sql, manifest] = await Promise.all([read(`supabase/migrations/${file}`), read("supabase/migration-baseline.json").then(JSON.parse)]);
  const entry = manifest.forwardMigrations.find((item) => item.file === file);
  assert.equal(entry?.sha256, createHash("sha256").update(sql).digest("hex"));
  assert.equal(entry?.requiresApproval, true);
  assert.deepEqual(entry?.appliedEnvironments, []);
  assert.match(sql, /add column if not exists steward_id uuid/);
  assert.match(sql, /d\.current_version <> p_expected_version/);
  assert.doesNotMatch(sql, /\b(?:delete from|truncate|drop table)\b/i);
});

test("repair API checks visibility and version before changing each source, and canonical edits become proposals", async () => {
  const [route, graph, ui] = await Promise.all([
    read("app/api/v1/knowledge/graph/repair/route.ts"), read("app/api/v1/knowledge/graph/route.ts"), read("components/knowledge-graph-workspace.tsx"),
  ]);
  assert.match(route, /\.max\(50\)/);
  assert.match(route, /readableKnowledgePages\(actor, \[current\]\)/);
  assert.match(route, /current\.current_version !== source\.expectedVersion/);
  assert.match(route, /createCanonicalProposal\(actor, current/);
  assert.match(route, /actor\.supabase\.rpc\("os_update_document"/);
  assert.match(graph, /readableKnowledgePages\(actor, rows\)/);
  assert.match(ui, /같은 링크/);
  assert.match(ui, /전체 연결/);
});
