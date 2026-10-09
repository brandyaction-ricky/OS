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
