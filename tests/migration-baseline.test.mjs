import assert from "node:assert/strict";
import test from "node:test";

import { inspectMigrationBaseline } from "../tools/check-migration-baseline.mjs";

test("legacy migrations are frozen while the core baseline is missing", async () => {
  const result = await inspectMigrationBaseline();

  assert.equal(result.status, "blocked_missing_core_baseline");
  assert.equal(result.decision, "do_not_apply");
  assert.equal(result.integrityValid, true);
  assert.equal(result.readyToApply, false);
  assert.equal(result.baselinePresent, false);
  assert.equal(result.migrationCount, 14);
  assert.deepEqual(result.errors, []);
});
