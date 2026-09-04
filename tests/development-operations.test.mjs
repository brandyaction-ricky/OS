import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("development logs and deployments are first-class operating records", async () => {
  const [types, validation, migration] = await Promise.all([
    read("lib/record-types.ts"),
    read("lib/record-validation.ts"),
    read("supabase/migrations/202609040013_development_operations.sql"),
  ]);
  for (const type of ["development_log", "deployment"]) {
    assert.match(types, new RegExp(`"${type}"`));
    assert.match(migration, new RegExp(`'${type}'`));
  }
  assert.match(validation, /z\.enum\(RECORD_TYPES\)/);
  assert.match(migration, /os_records_project_history_idx/);
});

test("project context is authenticated, uncached and returns categorized history", async () => {
  const route = await read("app/api/v1/project-context/route.ts");
  assert.match(route, /requiredAgentScope: "records\.read"/);
  assert.match(route, /assertOrganization/);
  assert.match(route, /eq\("parent_id", input\.projectId\)/);
  assert.match(route, /developmentLogs:/);
  assert.match(route, /deployments:/);
  assert.match(route, /private, no-store/);
});

test("Work can load project context and write a structured development log", async () => {
  const [mcp, route, navigation, workspace] = await Promise.all([
    read("lib/server/mcp.ts"),
    read("app/(os)/[stage]/[page]/page.tsx"),
    read("lib/navigation.ts"),
    read("components/project-hub-workspace.tsx"),
  ]);
  for (const tool of ["get_project_context", "create_development_log", "record_deployment"]) {
    assert.match(mcp, new RegExp(`name: "${tool}"`));
  }
  assert.match(mcp, /recordType: "development_log"/);
  assert.match(mcp, /changedFiles: input\.changed_files/);
  assert.match(mcp, /운영 배포 기록에는 사람 승인 근거가 필요합니다/);
  assert.match(navigation, /개발 관리/);
  assert.match(route, /knowledge\/development/);
  assert.match(workspace, /개발·배포 이력/);
});
