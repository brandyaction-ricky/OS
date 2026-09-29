import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { inspectMigrationBaseline } from "../tools/check-migration-baseline.mjs";
import { inspectSupabaseTooling } from "../tools/check-supabase-tooling.mjs";

test("the active chain is intact and the approved lifecycle release gate is clear", async () => {
  const result = await inspectMigrationBaseline();
  const manifest = JSON.parse(await readFile(new URL("../supabase/migration-baseline.json", import.meta.url), "utf8"));
  const lifecycle = manifest.forwardMigrations.find(entry => entry.file === "20260929025147_knowledge_attachment_lifecycle.sql");

  assert.equal(result.status, "ready");
  assert.equal(result.decision, "apply");
  assert.equal(result.integrityValid, true);
  assert.equal(result.readyToApply, true);
  assert.deepEqual(result.pendingApprovalMigrations, []);
  assert.equal(result.baselinePresent, true);
  assert.equal(result.activeMigrationCount, 13);
  assert.equal(result.archivedMigrationCount, 14);
  assert.deepEqual(lifecycle.appliedEnvironments, ["development", "production"]);
  assert.equal(lifecycle.requiresApproval, false);
  assert.deepEqual(result.errors, []);
});

test("Supabase local tooling is pinned and uses guarded defaults", async () => {
  const result = await inspectSupabaseTooling();

  assert.equal(result.cliVersion, "2.117.0");
  assert.equal(result.configValid, true);
  assert.deepEqual(result.errors, []);
});
