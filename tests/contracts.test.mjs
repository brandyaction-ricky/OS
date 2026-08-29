import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("integration migration is additive and protects the existing OS contract", async () => {
  const sql = await readFile(new URL("../supabase/migrations/202608290001_os_integrations.sql", import.meta.url), "utf8");
  assert.match(sql, /OS_CORE_SCHEMA_REQUIRED/);
  assert.match(sql, /create table if not exists public\.os_agent_keys/);
  assert.match(sql, /create table if not exists public\.os_search_logs/);
  assert.match(sql, /create table if not exists public\.os_channel_turns/);
  assert.doesNotMatch(sql, /drop table/i);
  assert.doesNotMatch(sql, /truncate\s/i);
});

test("agent keys remain canonical-only and cannot write through MCP", async () => {
  const migration = await readFile(new URL("../supabase/migrations/202608290001_os_integrations.sql", import.meta.url), "utf8");
  const mcp = await readFile(new URL("../integrations/mcp/os_knowledge_mcp.py", import.meta.url), "utf8");
  assert.match(migration, /allowed_statuses[^\n]+array\['canonical'\]/);
  assert.match(mcp, /OS_USER_JWT/);
  assert.match(mcp, /filters": \{"statuses": \["canonical"\]\}/);
});

test("operating core is additive, RLS protected and event audited", async () => {
  const sql = await readFile(new URL("../supabase/migrations/202608290002_operating_core.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.os_records/);
  assert.match(sql, /create table if not exists public\.os_record_events/);
  assert.match(sql, /alter table public\.os_records enable row level security/);
  assert.match(sql, /os_records_after_write_trigger/);
  assert.match(sql, /record_type text not null check/);
  assert.doesNotMatch(sql, /drop table/i);
  assert.doesNotMatch(sql, /truncate\s/i);
});

test("record API enforces optimistic updates and soft archives", async () => {
  const route = await readFile(new URL("../app/api/v1/records/route.ts", import.meta.url), "utf8");
  assert.match(route, /\.eq\("version", input\.expectedVersion\)/);
  assert.match(route, /RECORD_VERSION_CONFLICT/);
  assert.match(route, /archived_at: new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(route, /\.delete\(\)/);
});
