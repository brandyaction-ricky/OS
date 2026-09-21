import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("development logs and deployments are first-class operating records", async () => {
  const [types, validation, migration] = await Promise.all([
    read("lib/record-types.ts"),
    read("lib/record-validation.ts"),
    read("supabase/migrations-legacy/202609040013_development_operations.sql"),
  ]);
  for (const type of ["development_log", "deployment"]) {
    assert.match(types, new RegExp(`"${type}"`));
    assert.match(migration, new RegExp(`'${type}'`));
  }
  assert.match(validation, /z\.enum\(RECORD_TYPES\)/);
  assert.match(migration, /os_records_project_history_idx/);
});

test("development request conversations use a dedicated append-only contract", async () => {
  const [types, route, notificationRoute, memberRecords, agentRecords, workspace, migration, notificationMigration] = await Promise.all([
    read("lib/record-types.ts"),
    read("app/api/v1/development-request-comments/route.ts"),
    read("app/api/v1/development-notifications/route.ts"),
    read("app/api/v1/records/route.ts"),
    read("app/api/v1/agent-records/route.ts"),
    read("components/project-hub-workspace.tsx"),
    read("supabase/migrations/20260921170000_development_request_comments.sql"),
    read("supabase/migrations/20260921210000_development_request_notifications.sql"),
  ]);
  assert.match(types, /"development_comment"/);
  assert.match(types, /"development_notification"/);
  assert.match(route, /record_type: "development_comment"/);
  assert.match(route, /metadata: developmentCommentMetadata/);
  assert.match(route, /private, no-store/);
  assert.match(route, /mentionIds/);
  assert.match(notificationRoute, /owner_id", actor.ownerId/);
  assert.match(notificationRoute, /deliveredAt/);
  assert.match(notificationRoute, /readAt/);
  assert.match(migration, /DEVELOPMENT_COMMENT_IMMUTABLE/);
  assert.match(migration, /os_records_development_comment_idx/);
  assert.match(memberRecords, /COMMENT_API_REQUIRED/);
  assert.match(agentRecords, /COMMENT_API_REQUIRED/);
  assert.match(memberRecords, /NOTIFICATION_API_REQUIRED/);
  assert.match(agentRecords, /NOTIFICATION_API_REQUIRED/);
  assert.match(memberRecords, /neq\("record_type", "development_comment"\)/);
  assert.match(agentRecords, /neq\("record_type", "development_comment"\)/);
  assert.match(notificationMigration, /os_records_development_notification_inbox_idx/);
  assert.match(notificationMigration, /os_records_development_notification_dedupe_idx/);
  assert.match(notificationMigration, /DEVELOPMENT_NOTIFICATION_IMMUTABLE/);
  assert.match(notificationMigration, /reason', 'mention'/);
  assert.match(notificationMigration, /reason', 'assignment'/);
  assert.match(notificationMigration, /revoke execute on function public\.os_create_development_notifications\(\)/i);
  assert.match(notificationMigration, /from public, anon, authenticated/i);
  assert.match(notificationMigration, /to service_role/i);
  assert.match(workspace, /요청 대화/);
  assert.match(workspace, /name="comment"/);
  assert.match(workspace, /답글 남기기/);
  assert.match(workspace, /@ 함께 볼 사람/);
});

test("project context is authenticated, uncached and returns categorized history", async () => {
  const route = await read("app/api/v1/project-context/route.ts");
  assert.match(route, /requiredAgentScope: "records\.read"/);
  assert.match(route, /assertOrganization/);
  assert.match(route, /eq\("parent_id", input\.projectId\)/);
  assert.match(route, /developmentLogs:/);
  assert.match(route, /deployments:/);
  assert.match(route, /private, no-store/);
});

test("Work can load project context and write a request-linked structured development log", async () => {
  const [mcp, route, navigation, workspace, links] = await Promise.all([
    read("lib/server/mcp.ts"),
    read("app/(os)/[stage]/[page]/page.tsx"),
    read("lib/navigation.ts"),
    read("components/project-hub-workspace.tsx"),
    read("lib/development-links.ts"),
  ]);
  for (const tool of ["get_project_context", "create_development_log", "record_deployment"]) {
    assert.match(mcp, new RegExp(`name: "${tool}"`));
  }
  assert.match(mcp, /recordType: "development_log"/);
  assert.match(mcp, /request_id/);
  assert.match(mcp, /requestId: input\.request_id/);
  assert.match(mcp, /changedFiles: input\.changed_files/);
  assert.match(mcp, /운영 배포 기록에는 사람 승인 근거가 필요합니다/);
  assert.match(links, /DEVELOPMENT_REQUEST_PROJECT_MISMATCH/);
  assert.match(navigation, /개발 관리/);
  assert.match(route, /knowledge\/development/);
  assert.match(workspace, /개발·배포 기록/);
  assert.match(workspace, /자동 연결된 개발 이력/);
  assert.match(workspace, /name="assigneeId"/);
  assert.match(workspace, /담당자·처리 상태 업데이트/);
});
