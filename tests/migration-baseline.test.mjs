import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { inspectMigrationBaseline } from "../tools/check-migration-baseline.mjs";
import { inspectSupabaseTooling } from "../tools/check-supabase-tooling.mjs";

test("the active chain is intact and isolates the pending production-assets migration", async () => {
  const result = await inspectMigrationBaseline();
  const manifest = JSON.parse(await readFile(new URL("../supabase/migration-baseline.json", import.meta.url), "utf8"));
  const lifecycle = manifest.forwardMigrations.find(entry => entry.file === "20260929025147_knowledge_attachment_lifecycle.sql");
  const teamSharing = manifest.forwardMigrations.find(entry => entry.file === "20260929062422_share_team_documents_with_all_members.sql");
  const productionAssets = manifest.forwardMigrations.find(entry => entry.file === "20260930234912_content_production_assets.sql");

  assert.equal(result.status, "ready");
  assert.equal(result.decision, "apply");
  assert.equal(result.integrityValid, true);
  assert.equal(result.readyToApply, false);
  assert.deepEqual(result.pendingApprovalMigrations, ["20260930234912_content_production_assets.sql"]);
  assert.equal(result.baselinePresent, true);
  assert.equal(result.activeMigrationCount, 15);
  assert.equal(result.archivedMigrationCount, 14);
  assert.deepEqual(lifecycle.appliedEnvironments, ["development", "production"]);
  assert.equal(lifecycle.requiresApproval, false);
  assert.deepEqual(teamSharing.appliedEnvironments, ["development", "production"]);
  assert.equal(teamSharing.requiresApproval, false);
  assert.deepEqual(productionAssets.appliedEnvironments, ["development"]);
  assert.equal(productionAssets.requiresApproval, true);
  assert.deepEqual(result.errors, []);
});

test("Supabase local tooling is pinned and uses guarded defaults", async () => {
  const result = await inspectSupabaseTooling();

  assert.equal(result.cliVersion, "2.117.0");
  assert.equal(result.configValid, true);
  assert.deepEqual(result.errors, []);
});
