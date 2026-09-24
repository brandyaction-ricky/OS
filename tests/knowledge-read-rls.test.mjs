import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("human document lists, folders, detail, versions and graph retain user RLS", async () => {
  const [list, detail, versions, graph] = await Promise.all([
    source("../app/api/v1/documents/route.ts"),
    source("../app/api/v1/documents/[id]/route.ts"),
    source("../app/api/v1/documents/[id]/versions/route.ts"),
    source("../app/api/v1/knowledge/graph/route.ts"),
  ]);
  assert.match(list, /actor\.supabase\.from\("os_documents"\)\.select\("folder"\)/);
  assert.match(list, /let builder = actor\.supabase\s*\.from\("os_documents"\)/);
  assert.doesNotMatch(list, /createServiceSupabase/);
  assert.match(detail, /actor\.supabase\.from\("os_documents"\)\.select\("\*"\)/);
  assert.doesNotMatch(detail, /createServiceSupabase/);
  assert.match(versions, /actor\.supabase\.from\("os_document_versions"\)/);
  assert.match(graph, /actor\.supabase\s*\.from\("os_documents"\)/);
  assert.doesNotMatch(graph, /createServiceSupabase/);
});

test("agent document read keeps its explicit status and owner limits", async () => {
  const [route, policy] = await Promise.all([
    source("../app/api/v1/knowledge-documents/route.ts"),
    source("../supabase/migrations/20260917082749_core_baseline.sql"),
  ]);
  assert.match(route, /actor\.supabase\.from\("os_documents"\)\.select\("\*"\)/);
  assert.match(route, /actor\.supabase\.from\("os_documents"\)\.select\("\*"\)\.eq\("id", input\.documentId\)/);
  assert.match(route, /actor\.type === "agent"/);
  assert.match(route, /!actor\.allowedStatuses\.includes\(data\.status\)/);
  assert.match(route, /data\.status !== "canonical" && !ownsDocument/);
  assert.match(policy, /when p_owner = auth\.uid\(\) then true\s+when p_status = 'draft' then false/);
  assert.match(policy, /CREATE POLICY "os_documents_select"[\s\S]*?os_can_read_document/);
});
