import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("organization enters through meetings and keeps the legacy redirect", async () => {
  const [navigation, route] = await Promise.all([
    read("lib/navigation.ts"),
    read("app/(os)/[stage]/[page]/page.tsx"),
  ]);
  assert.match(
    navigation,
    /id: "organization",[\s\S]*?href: "\/organization\/meetings"/,
  );
  assert.match(
    route,
    /href === "\/organization\/projects"\) redirect\("\/organization\/meetings"\)/,
  );
});

test("task board exposes summary, due signals and meeting provenance", async () => {
  const tasks = await read("components/tasks-workspace.tsx");
  for (const label of ["전체 업무", "진행 중", "기한 임박", "7일 내 기한"])
    assert.match(tasks, new RegExp(label));
  assert.match(tasks, /daysUntilDue/);
  assert.match(tasks, /tone: "overdue"/);
  assert.match(tasks, /metadata\.meetingId/);
  assert.match(tasks, /회의 ·/);
  assert.match(tasks, /연결 프로젝트/);
});

test("member roster cards show representative role tags", async () => {
  const members = await read("components/members-workspace.tsx");
  assert.match(members, /representativeRoles/);
  assert.match(members, /roster-roles/);
  assert.match(members, /역할 미설정/);
});

test("leave balance covers the full BrandyAction roster without accounts", async () => {
  const [workspace, roster] = await Promise.all([
    read("components/organization-v3-workspaces.tsx"),
    read("lib/company-roster.ts"),
  ]);
  assert.match(workspace, /BRANDYACTION_ROSTER\.map/);
  assert.match(workspace, /계정 연결 전 · 연차 부여 정보 없음/);
  assert.match(workspace, /미등록/);
  for (const name of ["안저", "리키", "제이", "에릭", "유쓰", "로건", "시아"])
    assert.match(roster, new RegExp(name));
});

test("finance keeps default document folders and separates CSV guidance", async () => {
  const finance = await read("components/finance-workspace.tsx");
  for (const folder of ["사업자", "프로젝트", "기타"])
    assert.match(finance, new RegExp(`id: "${folder}"`));
  assert.match(finance, /민감정보 접근 권한 4명/);
  assert.match(finance, /csv-import-copy/);
  assert.match(finance, /<br \/>카드번호는 저장하지 않습니다/);
});
