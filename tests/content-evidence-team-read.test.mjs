import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("team evidence read is explicit, fail-closed, and leaves owner-only writes intact", async () => {
  const migration = await read("../supabase/migrations/20260923080000_content_evidence_team_read.sql");
  const ownerBoundary = await read("../supabase/migrations/20260923060000_content_evidence_owner_and_append_only.sql");
  assert.match(migration, /CREATE POLICY os_records_content_evidence_team_select[\s\S]*?AS RESTRICTIVE[\s\S]*?FOR SELECT TO authenticated/);
  assert.match(migration, /owner_id = \(SELECT auth\.uid\(\)\)/);
  assert.match(migration, /btrim\(team\) <> ''/);
  assert.match(migration, /btrim\(team\) = btrim\(\(SELECT public\.os_my_team\(\)\)\)/);
  assert.doesNotMatch(migration, /FOR (?:INSERT|UPDATE|DELETE)/);
  assert.match(ownerBoundary, /CREATE POLICY os_records_content_evidence_owner_insert[\s\S]*?owner_id = \(SELECT auth\.uid\(\)\)/);
  assert.match(ownerBoundary, /BEFORE UPDATE OR DELETE ON public\.os_records/);
});

test("a same-team contributor can append without turning submissions into approvals", async () => {
  const handoff = await read("../components/content-planning-handoff.tsx");
  const copy = await read("../components/content-copy-lineage.tsx");
  const claims = await read("../components/content-claim-evidence.tsx");
  assert.match(handoff, /같은 팀 구성원은 근거를 추가할 수 있습니다/);
  assert.equal((handoff.match(/state\.source\.team\.trim\(\) === profile\.team\.trim\(\)/g) ?? []).length, 2);
  assert.match(copy, /if \(saving\.current \|\| busy \|\| disabled \|\| !canWrite/);
  assert.match(copy, /\{canWrite \? <button/);
  assert.match(copy, /비교에 자동 반영되지 않습니다/);
  assert.match(claims, /if \(saving\.current \|\| disabled \|\| !canWrite\) return/);
  assert.match(claims, /\{canWrite \? <button/);
});

test("new evidence append policy binds author, team and parent topic and preserves immutability", async () => {
  const migration = await read("../supabase/migrations/20260923090000_content_evidence_team_append.sql");
  const immutable = await read("../supabase/migrations/20260923060000_content_evidence_owner_and_append_only.sql");
  assert.match(migration, /SECURITY DEFINER[\s\S]*?SET search_path = ''/);
  assert.match(migration, /source\.team = p_team/);
  assert.match(migration, /source\.owner_id = \(SELECT auth\.uid\(\)\)/);
  assert.match(migration, /public\.os_is_active_member\(\)/);
  assert.match(migration, /btrim\(source\.team\) = btrim\(\(SELECT public\.os_my_team\(\)\)\)/);
  assert.match(migration, /CREATE POLICY os_records_content_evidence_team_insert[\s\S]*?AS RESTRICTIVE[\s\S]*?FOR INSERT TO authenticated/);
  assert.match(migration, /owner_id = \(SELECT auth\.uid\(\)\)/);
  assert.match(migration, /public\.os_can_append_content_evidence\(parent_id, team\)/);
  assert.doesNotMatch(migration, /FOR (?:UPDATE|DELETE)/);
  assert.match(immutable, /BEFORE UPDATE OR DELETE ON public\.os_records/);
});
