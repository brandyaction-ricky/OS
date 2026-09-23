import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("team evidence read is explicit, fail-closed, and leaves owner-only writes intact", async () => {
  const migration = await read("../supabase/migrations/20260923070000_content_evidence_team_read.sql");
  const ownerBoundary = await read("../supabase/migrations/20260923060000_content_evidence_owner_and_append_only.sql");
  assert.match(migration, /CREATE POLICY os_records_content_evidence_team_select[\s\S]*?AS RESTRICTIVE[\s\S]*?FOR SELECT TO authenticated/);
  assert.match(migration, /owner_id = \(SELECT auth\.uid\(\)\)/);
  assert.match(migration, /btrim\(team\) <> ''/);
  assert.match(migration, /btrim\(team\) = btrim\(\(SELECT public\.os_my_team\(\)\)\)/);
  assert.doesNotMatch(migration, /FOR (?:INSERT|UPDATE|DELETE)/);
  assert.match(ownerBoundary, /CREATE POLICY os_records_content_evidence_owner_insert[\s\S]*?owner_id = \(SELECT auth\.uid\(\)\)/);
  assert.match(ownerBoundary, /BEFORE UPDATE OR DELETE ON public\.os_records/);
});

test("a non-owner gets read-only evidence cards in the existing content screen", async () => {
  const handoff = await read("../components/content-planning-handoff.tsx");
  const copy = await read("../components/content-copy-lineage.tsx");
  const claims = await read("../components/content-claim-evidence.tsx");
  assert.match(handoff, /팀 공유 읽기 전용/);
  assert.equal((handoff.match(/canWrite=\{profile\?\.id === state\.source\.owner_id\}/g) ?? []).length, 2);
  assert.match(copy, /if \(saving\.current \|\| busy \|\| disabled \|\| !canWrite\) return/);
  assert.match(copy, /\{canWrite \? <button/);
  assert.match(claims, /if \(saving\.current \|\| disabled \|\| !canWrite\) return/);
  assert.match(claims, /\{canWrite \? <button/);
});
