import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("MCP restores trash documents with scope, version, confirmation and audit gates", () => {
  const mcp = read("lib/server/mcp.ts");
  const route = read("app/api/v1/knowledge-documents/route.ts");
  const documentRoute = read("app/api/v1/documents/[id]/route.ts");
  const migration = read("supabase/migrations/20260920033000_agent_document_restore.sql");

  assert.match(mcp, /name: "restore_document"/);
  assert.match(mcp, /confirm: z\.literal\(true\)/);
  assert.match(mcp, /expected_version: z\.number\(\)\.int\(\)\.positive\(\)/);
  assert.match(route, /requiredAgentScope: "knowledge\.write"/);
  assert.doesNotMatch(route, /ownsDocument/);
  assert.doesNotMatch(documentRoute, /data\.owner_id !== actor\.ownerId/);
  assert.match(route, /os_agent_restore_document/);
  assert.match(migration, /d\.current_version <> p_expected_version/);
  assert.match(migration, /v_restore_status = any\(k\.allowed_statuses\)/);
  assert.match(migration, /not \(d\.status = any\(k\.allowed_statuses\)\)/);
  assert.doesNotMatch(migration, /d\.owner_id <> k\.owner_user_id/);
  assert.match(migration, /'knowledge\.restore'/);
  assert.match(migration, /set_config\('os\.status_change_ok', '1'/);
  assert.match(migration, /insert into public\.os_document_events/);
  assert.match(migration, /grant execute[\s\S]+service_role/);
  assert.doesNotMatch(migration, /^grant execute .* to (?:public|anon|authenticated);$/mi);
});
