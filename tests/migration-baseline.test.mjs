import assert from "node:assert/strict";
import test from "node:test";

import { inspectMigrationBaseline } from "../tools/check-migration-baseline.mjs";
import { inspectSupabaseTooling } from "../tools/check-supabase-tooling.mjs";

test("the active chain is intact but evidence migrations still require environment approval", async () => {
  const result = await inspectMigrationBaseline();

  assert.equal(result.status, "ready");
  assert.equal(result.decision, "apply");
  assert.equal(result.integrityValid, true);
  assert.equal(result.readyToApply, false);
  assert.deepEqual(result.pendingApprovalMigrations, [
    "20260923060000_content_evidence_owner_and_append_only.sql",
    "20260923080000_content_evidence_team_read.sql",
    "20260923090000_content_evidence_team_append.sql",
  ]);
  assert.equal(result.baselinePresent, true);
  assert.equal(result.activeMigrationCount, 14);
  assert.equal(result.archivedMigrationCount, 14);
  assert.deepEqual(result.errors, []);
});

test("Supabase local tooling is pinned and uses guarded defaults", async () => {
  const result = await inspectSupabaseTooling();

  assert.equal(result.cliVersion, "2.117.0");
  assert.equal(result.configValid, true);
  assert.deepEqual(result.errors, []);
});
