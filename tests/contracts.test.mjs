import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("integration migration is additive and protects the existing OS contract", async () => {
  const sql = await readFile(new URL("../supabase/migrations-legacy/202608290001_os_integrations.sql", import.meta.url), "utf8");
  assert.match(sql, /OS_CORE_SCHEMA_REQUIRED/);
  assert.match(sql, /create table if not exists public\.os_agent_keys/);
  assert.match(sql, /create table if not exists public\.os_search_logs/);
  assert.match(sql, /create table if not exists public\.os_channel_turns/);
  assert.doesNotMatch(sql, /drop table/i);
  assert.doesNotMatch(sql, /truncate\s/i);
});

test("scoped agent keys expose audited and reversible knowledge writes", async () => {
  const [baseMigration, writeMigration, mcp, route, manager] = await Promise.all([
    readFile(new URL("../supabase/migrations-legacy/202608290001_os_integrations.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations-legacy/202608310010_agent_knowledge_write.sql", import.meta.url), "utf8"),
    readFile(new URL("../integrations/mcp/os_knowledge_mcp.py", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/knowledge-documents/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/agent-key-manager.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(baseMigration, /allowed_statuses[^\n]+array\['canonical'\]/);
  assert.match(writeMigration, /'knowledge\.read', 'knowledge\.write'/);
  assert.match(writeMigration, /os_agent_audit_logs/);
  assert.match(writeMigration, /os_assert_agent_write_access/);
  assert.match(writeMigration, /OS_AGENT_RATE_LIMITED/);
  assert.match(writeMigration, /set status = 'archived'/);
  assert.doesNotMatch(writeMigration, /delete from public\.os_documents/i);
  assert.match(route, /status: "draft"/);
  assert.match(route, /os_agent_update_document/);
  assert.match(route, /os_agent_archive_document/);
  assert.match(mcp, /ORG_UUID/);
  for (const tool of ["search_knowledge", "get_document", "create_document", "edit_document", "delete_document"]) {
    assert.match(mcp, new RegExp(`"name": "${tool}"`));
  }
  assert.match(mcp, /confirm=true/);
  assert.doesNotMatch(mcp, /OS_USER_JWT/);
  assert.match(manager, /한 번만 표시되는 PAT/);
  assert.match(manager, /읽기·쓰기/);
  assert.match(manager, /AI 접근 키 연결 검증/);
  assert.match(manager, /type="password"/);
  assert.match(manager, /create_document/);
  assert.match(manager, /edit_document/);
  assert.match(manager, /delete_document/);
});

test("agent knowledge rate limits expose retry metadata without leaking raw responses", async () => {
  const [migration, route, http, mcp] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260921233000_agent_write_rate_limit_metadata.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/knowledge-documents/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/http.ts", import.meta.url), "utf8"),
    readFile(new URL("../integrations/mcp/os_knowledge_mcp.py", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /os_agent_write_rate_limits/);
  assert.match(migration, /knowledge\.move/);
  assert.match(migration, /when p_action = 'knowledge\.update' then 1000/);
  assert.match(migration, /retryAfterSeconds/);
  assert.match(migration, /resetAt/);
  assert.doesNotMatch(migration, /drop table|truncate\s/i);
  assert.match(route, /Retry-After/);
  assert.match(route, /retryAfterSeconds/);
  assert.match(http, /headers: error\.headers/);
  assert.match(mcp, /safe_http_error/);
  assert.match(mcp, /AGENT_RATE_LIMITED/);
  assert.doesNotMatch(mcp, /OS API \{error\.code\}: \{detail\}/);
});

test("operating core is additive, RLS protected and event audited", async () => {
  const sql = await readFile(new URL("../supabase/migrations-legacy/202608290002_operating_core.sql", import.meta.url), "utf8");
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
  assert.match(workspace, /exactFolder: "true"/);
  assert.match(workspace, /getDocument\(accessToken, selectedId\)/);
  assert.match(client, /sourceRef\?: string \| null/);
  assert.match(route, /DOCUMENT_SOURCE_EXISTS/);
  assert.match(route, /\.eq\("source_ref", input\.sourceRef\)/);
});

test("meeting recordings stay private, bounded, and use signed playback URLs", async () => {
  const migration = await readFile(new URL("../supabase/migrations-legacy/202608290003_meeting_recordings.sql", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/v1/meeting-recordings/route.ts", import.meta.url), "utf8");
  assert.match(migration, /'os-meeting-recordings'/);
  assert.match(migration, /false,/);
  assert.doesNotMatch(migration, /drop table|truncate\s/i);
  assert.match(route, /MAX_BYTES = 4_000_000/);
  assert.match(route, /createSignedUrl\(path, 3600\)/);
  assert.match(route, /authenticateRequest\(request\)/);
});

test("meeting summaries degrade locally and create linked actions", async () => {
  const route = await readFile(new URL("../lib/server/meeting-summary.ts", import.meta.url), "utf8");
  const workspace = await readFile(new URL("../components/meeting-workspace.tsx", import.meta.url), "utf8");
  assert.match(route, /localSummary/);
  assert.match(route, /OPENAI_API_KEY/);
  assert.match(workspace, /recordType: "decision"[\s\S]*parentId: meeting\.id/);
  assert.match(workspace, /recordType: "task"[\s\S]*parentId: meeting\.id/);
});

test("saving a meeting on the web pushes the same raw+summary documents as /회의기록", async () => {
  const [workspace, documents, business] = await Promise.all([
    readFile(new URL("../components/meeting-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/meeting-documents.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/meeting-business.ts", import.meta.url), "utf8"),
  ]);
  // 웹 저장이 텔레그램 /회의기록과 같은 빌더·사업 판정을 재사용한다(로직 두 곳에 흩어지지 않음).
  assert.match(workspace, /from "@\/lib\/meeting-business"/);
  assert.match(workspace, /from "@\/lib\/meeting-documents"/);
  // 요약이 있고 사업(브랜드)을 알아볼 수 있고 아직 문서함에 안 올라간 경우에만 한 번 실행한다.
  assert.match(workspace, /summary\.trim\(\)\s*&&\s*business\s*&&\s*!existingDocuments\?\.rawId\s*&&\s*!existingDocuments\?\.summaryId/);
  assert.match(workspace, /createDocument\(accessToken, \{ title: raw\.title/);
  assert.match(workspace, /createDocument\(accessToken, \{ title: summaryDoc\.title/);
  assert.match(workspace, /knowledgeDocuments: \{ rawId:.*summaryId:/);
  // 저장된 회의를 다시 열면 문서함 링크가 보인다(정호가 실제로 눌러 확인할 수 있게).
  assert.match(workspace, /linkedDocuments\.summaryId/);
  assert.match(workspace, /linkedDocuments\.rawId/);
  assert.match(documents, /01_Raw\/주간회의\/\$\{date\.slice\(0, 7\)\}/);
  assert.match(documents, /02_Wiki\/\$\{business\.wikiFolderSegment\}\/운영\/주간회의요약\/\$\{date\.slice\(0, 7\)\}/);
  assert.match(business, /"마이인\(진단\)"/);
  assert.match(business, /"자영업 교육"/);
});

test("project, task, skill and content workspaces use linked operating records", async () => {
  const project = await readFile(new URL("../components/project-hub-workspace.tsx", import.meta.url), "utf8");
  const tasks = await readFile(new URL("../components/tasks-workspace.tsx", import.meta.url), "utf8");
  const skills = await readFile(new URL("../components/skills-workspace.tsx", import.meta.url), "utf8");
  const content = await readFile(new URL("../components/content-automation-workspace.tsx", import.meta.url), "utf8");
  assert.match(project, /parentId: value\("parentId"\)/);
  assert.match(project, /api\/v1\/development-requests/);
  assert.match(tasks, /assigneeId/);
  assert.match(tasks, /parentId/);
  assert.match(skills, /scope: "company"/);
  assert.match(content, /count: 3, days: \[1, 1, 1\]/);
  assert.match(content, /action: "derivatives", sourceId: source\.id/);
});

test("specialized routes expose reports, growth and monitoring without placeholders", async () => {
  const router = await readFile(new URL("../app/(os)/[stage]/[page]/page.tsx", import.meta.url), "utf8");
  for (const route of ["/home/reports", "/organization/projects", "/organization/tasks", "/organization/meetings", "/content/automation", "/content/review", "/content/calendar", "/knowledge/skills", "/performance/overview", "/settings/monitoring"]) {
    assert.match(router, new RegExp(route.replaceAll("/", "\\/")));
  }
});

test("embedding backlog has admin control, cron authentication and bounded batches", async () => {
  const [indexing, adminRoute, cronRoute, config] = await Promise.all([
    readFile(new URL("../lib/server/indexing.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/indexing/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/indexing/cron/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  ]);
  assert.match(indexing, /eq\("status", "pending"\).*select\("id"\)/s);
  assert.match(indexing, /limit = Math\.min\(Math\.max/);
  assert.match(indexing, /retryFailedEmbeddingJobs/);
  assert.match(indexing, /중단된 실행을 자동 복구했습니다/);
  assert.match(indexing, /새 문서 버전으로 대체된 작업입니다/);
  assert.match(indexing, /previousChunks/);
  assert.match(adminRoute, /actor\.role !== "admin"/);
  assert.match(cronRoute, /CRON_SECRET/);
  assert.match(cronRoute, /safeSecretMatch/);
  assert.match(config, /\/api\/v1\/indexing\/cron/);
});

test("telegram setup is admin-only and never returns bot secrets", async () => {
  const [route, webhook] = await Promise.all([readFile(new URL("../app/api/v1/telegram/setup/route.ts", import.meta.url), "utf8"), readFile(new URL("../app/api/v1/telegram/webhook/route.ts", import.meta.url), "utf8")]);
  assert.match(route, /actor\.role !== "admin"/);
  assert.match(route, /setWebhook/);
  assert.match(route, /secret_token: secret/);
  assert.match(route, /pendingUsers/);
  assert.match(webhook, /TELEGRAM_ACCESS_PENDING/);
  assert.match(webhook, /!allowed\.has/);
  assert.doesNotMatch(route, /token:\s*process\.env\.TELEGRAM_BOT_TOKEN/);
});

test("build is side-effect free and webhook registration is explicit", async () => {
  const [pkg, script] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../tools/register-telegram-webhook.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(pkg, /"build": "next build"/);
  assert.match(pkg, /"telegram:webhook:register": "node tools\/register-telegram-webhook\.mjs"/);
  assert.match(script, /TELEGRAM_BOT_TOKEN/);
  assert.match(script, /TELEGRAM_WEBHOOK_SECRET/);
  assert.match(script, /OS_PUBLIC_URL/);
  assert.match(script, /OS_ENVIRONMENT/);
  assert.match(script, /--confirm/);
  assert.match(script, /secret_token: secret/);
  assert.doesNotMatch(script, /console\.log\([^\n]*(token|secret)[^\n]*\)/);
});

test("local bootstrap is pinned, non-destructive, and matches CI", async () => {
  const [nodeVersion, pkg, setup, envCheck, workflow, environmentDocs] = await Promise.all([
    readFile(new URL("../.nvmrc", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../tools/setup-local.mjs", import.meta.url), "utf8"),
    readFile(new URL("../tools/check-environment.mjs", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/validate.yml", import.meta.url), "utf8"),
    readFile(new URL("../docs/ENVIRONMENTS.md", import.meta.url), "utf8"),
  ]);
  assert.match(nodeVersion, /^24\.21\.0\s*$/);
  assert.match(pkg, /"setup:local": "node tools\/setup-local\.mjs"/);
  assert.match(pkg, /"verify": "npm run env:check/);
  assert.match(setup, /already exists; no changes made/);
  assert.match(setup, /flag: "wx"/);
  assert.match(setup, /mode: 0o600/);
  assert.doesNotMatch(envCheck, /console\.(?:log|error)\([^\n]*valueFor\(/);
  assert.match(workflow, /node-version-file: \.nvmrc/);
  assert.match(workflow, /npm run verify/);
  assert.match(environmentDocs, /DEV[\s\S]*QA[\s\S]*Production/);
});

test("telegram operational questions distinguish empty data from search failure", async () => {
  const webhook = await readFile(new URL("../app/api/v1/telegram/webhook/route.ts", import.meta.url), "utf8");
  assert.match(webhook, /현재 브랜디 OS에 등록된 \$\{intent\.label\}이 없습니다/);
});
