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

test("monthly goals connect KPIs without a new database contract", async () => {
  const workspace = await readFile(new URL("../components/goals-workspace.tsx", import.meta.url), "utf8");
  const router = await readFile(new URL("../app/(os)/[stage]/[page]/page.tsx", import.meta.url), "utf8");
  assert.match(workspace, /listRecords\(accessToken, "goal"/);
  assert.match(workspace, /listRecords\(accessToken, "kpi"/);
  assert.match(workspace, /periodMonth/);
  assert.match(workspace, /parentId/);
  assert.match(router, /href === "\/home\/goals"/);
});

test("wiki imports Markdown as deduplicated drafts and paginates documents", async () => {
  const workspace = await readFile(new URL("../components/knowledge-workspace.tsx", import.meta.url), "utf8");
  const client = await readFile(new URL("../lib/api-client.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/v1/documents/route.ts", import.meta.url), "utf8");
  assert.match(workspace, /accept="\.md,text\/markdown"/);
  assert.match(workspace, /source: "markdown"/);
  assert.match(workspace, /sourceRef: item\.fileName/);
  assert.match(workspace, /item\.duplicate/);
  assert.match(workspace, /limit=100&offset=/);
  assert.match(client, /sourceRef\?: string \| null/);
  assert.match(route, /DOCUMENT_SOURCE_EXISTS/);
  assert.match(route, /\.eq\("source_ref", input\.sourceRef\)/);
});

test("meeting recordings stay private, bounded, and use signed playback URLs", async () => {
  const migration = await readFile(new URL("../supabase/migrations/202608290003_meeting_recordings.sql", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/v1/meeting-recordings/route.ts", import.meta.url), "utf8");
  assert.match(migration, /'os-meeting-recordings'/);
  assert.match(migration, /false,/);
  assert.doesNotMatch(migration, /drop table|truncate\s/i);
  assert.match(route, /MAX_BYTES = 4_000_000/);
  assert.match(route, /createSignedUrl\(path, 3600\)/);
  assert.match(route, /authenticateRequest\(request\)/);
});

test("meeting summaries degrade locally and create linked actions", async () => {
  const route = await readFile(new URL("../app/api/v1/meeting-summary/route.ts", import.meta.url), "utf8");
  const workspace = await readFile(new URL("../components/meeting-workspace.tsx", import.meta.url), "utf8");
  assert.match(route, /localSummary/);
  assert.match(route, /OPENAI_API_KEY/);
  assert.match(workspace, /recordType: "decision", parentId: meeting\.id/);
  assert.match(workspace, /recordType: "task", parentId: meeting\.id/);
});

test("project, task, skill and content workspaces use linked operating records", async () => {
  const project = await readFile(new URL("../components/project-hub-workspace.tsx", import.meta.url), "utf8");
  const tasks = await readFile(new URL("../components/tasks-workspace.tsx", import.meta.url), "utf8");
  const skills = await readFile(new URL("../components/skills-workspace.tsx", import.meta.url), "utf8");
  const content = await readFile(new URL("../components/content-automation-workspace.tsx", import.meta.url), "utf8");
  assert.match(project, /recordType: "ai_job", parentId: selected\.id/);
  assert.match(tasks, /assigneeId/);
  assert.match(tasks, /parentId/);
  assert.match(skills, /scope: "company"/);
  assert.match(content, /count: 3, days: \[1, 1, 1\]/);
  assert.match(content, /recordType: "content_publish", parentId: source\.id/);
});

test("specialized routes expose reports, growth and monitoring without placeholders", async () => {
  const router = await readFile(new URL("../app/(os)/[stage]/[page]/page.tsx", import.meta.url), "utf8");
  for (const route of ["/home/reports", "/organization/projects", "/organization/tasks", "/organization/meetings", "/content/automation", "/content/review", "/content/calendar", "/knowledge/skills", "/performance/overview", "/settings/monitoring"]) {
    assert.match(router, new RegExp(route.replaceAll("/", "\\/")));
  }
});
