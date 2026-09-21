import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sql = await readFile(new URL("../supabase/migrations/20260921140000_agent_update_daily_limit.sql", import.meta.url), "utf8");
const baseline = await readFile(new URL("../supabase/migrations/20260917082749_core_baseline.sql", import.meta.url), "utf8");
const oldRule = sql.match(/old_rule constant text := '((?:''|[^'])*)';/)[1].replaceAll("''", "'");
const newRule = sql.match(/new_rule constant text := '((?:''|[^'])*)';/)[1].replaceAll("''", "'");

test("quota patch changes only the daily update branch", () => {
  assert.equal(oldRule, "v_day_limit integer := case when p_action = 'knowledge.delete' then 30 else 200 end;");
  assert.equal(newRule, "v_day_limit integer := case when p_action = 'knowledge.delete' then 30 when p_action = 'knowledge.update' then 1000 else 200 end;");
  assert.equal(baseline.split(oldRule).length, 2);
  const patched = baseline.replace(oldRule, newRule);
  assert.equal(patched.replace(newRule, oldRule), baseline);
  assert.ok(patched.includes("v_minute_limit integer := case when p_action = 'knowledge.delete' then 5 else 20 end;"));
});

test("quota migration is guarded, idempotent and preserves the deployed function", () => {
  assert.ok(sql.includes("pg_get_functiondef('public.os_assert_agent_write_access(uuid,uuid,text)'::regprocedure)"));
  assert.ok(sql.includes("IF strpos(definition, new_rule) > 0 THEN\n    RETURN;"));
  assert.ok(sql.includes("(length(definition) - length(replace(definition, old_rule, ''))) <> length(old_rule)"));
  assert.ok(sql.includes("RAISE EXCEPTION 'Unexpected agent quota definition; inspect before applying'"));
  assert.ok(sql.includes("EXECUTE replace(definition, old_rule, new_rule);"));
  assert.doesNotMatch(sql, /\b(DROP|GRANT|REVOKE|TRUNCATE)\b/i);
});
