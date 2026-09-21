import assert from "node:assert/strict";
import test from "node:test";

import { inspectMigrationBaseline } from "../tools/check-migration-baseline.mjs";
import { inspectSupabaseTooling } from "../tools/check-supabase-tooling.mjs";

test("the reviewed active chain is isolated from frozen legacy migrations", async () => {
  const result = await inspectMigrationBaseline();

  assert.equal(result.status, "applied_dev_and_production");
  assert.equal(result.decision, "applied");
  assert.equal(result.integrityValid, true);
  assert.equal(result.readyToApply, false);
  assert.equal(result.baselinePresent, true);
  assert.equal(result.activeMigrationCount, 7);
  assert.equal(result.archivedMigrationCount, 14);
  assert.deepEqual(result.errors, []);
});

test("Supabase local tooling is pinned and uses guarded defaults", async () => {
  const result = await inspectSupabaseTooling();

  assert.equal(result.cliVersion, "2.117.0");
  assert.equal(result.configValid, true);
  assert.deepEqual(result.errors, []);
});
