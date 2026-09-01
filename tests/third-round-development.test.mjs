import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("third-round member directory edits pending roster without inventing accounts", async () => {
  const [route, workspace] = await Promise.all([
    read("app/api/v1/members/route.ts"),
    read("components/members-workspace.tsx"),
  ]);
  assert.match(route, /member-directory/);
  assert.match(route, /account_connected: false/);
  assert.match(workspace, /const accounts = members\.filter/);
  assert.match(workspace, /초대 구성원 정보 저장/);
  assert.doesNotMatch(workspace, /disabled=!\{account\}/);
});

test("third-round scripts paginate all synchronized documents and use source filenames", async () => {
  const workspace = await read("components/content-pipeline-workspaces.tsx");
  assert.match(workspace, /for \(let offset = 0; ; offset \+= 200\)/);
  assert.match(workspace, /loaded\.length >= result\.total/);
  assert.match(workspace, /a\.source_ref \|\| a\.title/);
  assert.match(workspace, /개인 초안/);
});

test("third-round record history is restorable and remains audited", async () => {
  const [route, workspace, audit] = await Promise.all([
    read("app/api/v1/records/[id]/versions/route.ts"),
    read("components/operations-workspace.tsx"),
    read("app/api/v1/audit/route.ts"),
  ]);
  assert.match(route, /expectedVersion/);
  assert.match(route, /event_type: "restored"/);
  assert.match(workspace, /listRecordVersions/);
  assert.match(workspace, /restoreRecordVersion/);
  assert.match(audit, /record\.restore/);
});

test("Claude and Codex record tools keep the three human approval gates", async () => {
  const [mcp, route, migration] = await Promise.all([
    read("lib/server/mcp.ts"),
    read("app/api/v1/agent-records/route.ts"),
    read("supabase/migrations/202609010011_agent_operating_records.sql"),
  ]);
  for (const tool of ["list_records", "get_record", "create_record", "edit_record", "delete_record"]) assert.match(mcp, new RegExp(`name: "${tool}"`));
  assert.match(route, /HUMAN_PERMISSION_GATE/);
  assert.match(route, /HUMAN_PUBLISH_GATE/);
  assert.match(route, /permanent: false/);
  assert.match(route, /os_agent_audit_logs/);
  assert.match(migration, /records\.read/);
  assert.match(migration, /records\.write/);
});

test("third-round quick fixes cover performance CRUD, meeting anchors and shorts rollback", async () => {
  const [performance, meeting, shorts, packaging] = await Promise.all([
    read("components/performance-workspaces.tsx"),
    read("components/meeting-workspace.tsx"),
    read("components/content-shortform-workspace.tsx"),
    read("components/content-packaging-workspace.tsx"),
  ]);
  assert.match(performance, /매출 기록을 휴지통으로 이동/);
  assert.match(performance, /주간 KPI 수정/);
  assert.match(meeting, /meeting-transcript/);
  assert.match(meeting, /회의 원문을 20자 이상/);
  assert.match(shorts, /manualUnsaved/);
  assert.match(shorts, /removeClip/);
  assert.match(packaging, /새 주제로 검증/);
});
