import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("archive read migration narrows only deleted documents and preserves role order", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260924131455_archived_document_owner_read.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.os_can_read_document/);
  assert.match(migration, /WHEN auth\.uid\(\) IS NULL THEN false\s+WHEN os_is_admin\(\) THEN true\s+WHEN p_owner = auth\.uid\(\) THEN true\s+WHEN p_status IN \('draft', 'archived'\) THEN false/);
  assert.match(migration, /WHEN p_status = 'team' THEN \(p_team = '' OR p_team = os_my_team\(\) OR os_is_lead_or_admin\(\)\)/);
  assert.match(migration, /ELSE true/);
  assert.doesNotMatch(migration, /CREATE POLICY|GRANT |REVOKE |INSERT INTO|DELETE FROM/);
});

test("transaction-scoped SQL QA covers teammate, owner, admin and anonymous archive access", async () => {
  const sql = await readFile(new URL("../supabase/tests/archived_document_read_test.sql", import.meta.url), "utf8");
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /SELECT plan\(9\)/);
  assert.match(sql, /teammate cannot read an archived document/);
  assert.match(sql, /teammate cannot read archived document versions/);
  assert.match(sql, /owner can recover their archived document/);
  assert.match(sql, /administrator can recover another member archive/);
  assert.match(sql, /same-team document remains readable/);
  assert.match(sql, /company canonical document remains readable/);
  assert.match(sql, /anonymous user cannot read the archive/);
  assert.match(sql, /ROLLBACK;\s*$/);
});
