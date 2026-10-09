import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("company workspace keeps optional pre-existing HR notification types", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261008180414_knowledge_workspace.sql", import.meta.url), "utf8");
  const guard = sql.slice(sql.indexOf("create or replace function public.os_notification_guard()"));
  assert.match(guard, /to_regclass\('public\.os_hr_employees'\) is not null/);
  assert.match(guard, /'hr_employee','hr_leave','hr_promotion'/);
  assert.match(guard, /'record','document'/);
  assert.match(guard, /knowledge_review.*knowledge_update.*knowledge_access.*knowledge_reminder.*knowledge_mention/);
  assert.match(guard, /NOTIFICATION_IMMUTABLE/);
});

test("hosted PostgREST business conflicts return HTTP 409 without serialization retries", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261009023548_knowledge_conflict_response.sql", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/v1/knowledge/workspace/route.ts", import.meta.url), "utf8");
  assert.match(sql, /PT409/);
  assert.match(sql, /regexp_replace\(original/);
  assert.match(sql, /KNOWLEDGE_CONFLICT_PREREQUISITE_MISSING/);
  assert.match(sql, /KNOWLEDGE_CONFLICT_DEFINITION_UNEXPECTED/);
  assert.equal((sql.match(/'public\.os_[a-z_]+\(/g) ?? []).length, 6);
  assert.match(route, /error\.code === "PT409"/);
  assert.doesNotMatch(sql, /(?:delete from|update public\.|alter policy|grant |revoke )/i);
});
