import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("third handoff adds metadata-first knowledge tree and lazy bodies", async () => {
  const [migration, route, workspace] = await Promise.all([read("supabase/migrations/202608290005_operating_v3.sql"), read("app/api/v1/documents/route.ts"), read("components/knowledge-workspace.tsx")]);
  assert.match(migration, /os_list_documents_v3/);
  assert.match(migration, /case when p_include_content/);
  assert.match(route, /view.*summary/);
  assert.match(workspace, /buildFolderTree/);
  assert.match(workspace, /text\/document-id/);
  assert.match(workspace, /백링크/);
});

test("finance records are isolated and private files are signed", async () => {
  const [migration, files, finance] = await Promise.all([read("supabase/migrations/202608290005_operating_v3.sql"), read("app/api/v1/company-files/route.ts"), read("components/finance-workspace.tsx")]);
  assert.match(migration, /os_has_finance_access/);
  assert.match(migration, /record_type not in \('expense', 'contract', 'subscription', 'company_document'\)/);
  assert.match(files, /createSignedUrl/);
  assert.match(files, /finance_access/);
  assert.match(finance, /국민·신한/);
  assert.match(finance, /부가세/);
});

test("leave decisions are atomic and telegram users are approved in the OS", async () => {
  const [migration, records, telegram, monitor] = await Promise.all([read("supabase/migrations/202608290005_operating_v3.sql"), read("app/api/v1/records/route.ts"), read("app/api/v1/telegram/setup/route.ts"), read("components/monitoring-workspace.tsx")]);
  assert.match(migration, /os_decide_leave_request/);
  assert.match(migration, /for update/);
  assert.match(records, /LEAVE_DECISION_FAILED/);
  assert.match(telegram, /export async function PATCH/);
  assert.match(monitor, /decideTelegramUser/);
});

test("home and organization expose the third handoff operating flow", async () => {
  const [dashboard, navigation, meeting, tasks] = await Promise.all([read("components/dashboard.tsx"), read("lib/navigation.ts"), read("components/meeting-workspace.tsx"), read("components/tasks-workspace.tsx")]);
  for (const label of ["통합 순매출", "이번 주 핵심 이슈", "이번 주 영상", "최근 지식"]) assert.match(dashboard, new RegExp(label));
  for (const route of ["/organization/schedule", "/organization/leave", "/organization/finance"]) assert.match(navigation, new RegExp(route));
  assert.match(meeting, /원본 폐기됨/);
  assert.match(tasks, /sourceFilter/);
});
