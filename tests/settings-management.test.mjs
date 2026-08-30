import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("settings wait for real data before rendering status and counts", async () => {
  const [settings, monitoring, audit] = await Promise.all([
    read("components/settings-workspaces.tsx"),
    read("components/monitoring-workspace.tsx"),
    read("components/audit-workspace.tsx"),
  ]);
  assert.match(settings, /SettingsLoading/);
  assert.match(settings, /const \[loaded, setLoaded\]/);
  assert.match(monitoring, /운영 상태를 확인하는 중입니다/);
  assert.match(monitoring, /!loaded/);
  assert.match(audit, /변경 이력을 불러오는 중입니다/);
  assert.match(audit, /loading \? "확인 중"/);
});

test("connection status uses automatic health values and distinct dot colors", async () => {
  const [settings, css] = await Promise.all([
    read("components/settings-workspaces.tsx"),
    read("app/globals.css"),
  ]);
  for (const field of [
    "database",
    "auth",
    "embeddings",
    "telegram",
    "contentAi",
    "youtube",
    "youtubeOAuth",
    "advertising",
  ]) assert.match(settings, new RegExp(`health\\?\\.${field}|health\\.${field}`));
  assert.match(settings, /state-dot \$\{row\.status\}/);
  assert.match(css, /\.state-dot\.waiting/);
  assert.match(css, /\.state-dot\.warning/);
});

test("audit events and statuses are rendered in plain Korean", async () => {
  const labels = await import("../lib/audit-labels.ts");
  assert.equal(labels.auditEventLabel("created"), "생성");
  assert.equal(labels.auditRecordLabel("title_package"), "제목·썸네일");
  assert.equal(labels.auditRecordLabel("shorts_proposal"), "숏폼 기획안");
  assert.equal(labels.auditRecordLabel("derivatives"), "파생물");
  assert.equal(labels.auditStatusLabel("blocked", "content_package"), "비공개");
  assert.equal(labels.auditStatusLabel("review", "content_package"), "검토 중");
  assert.equal(labels.auditStatusLabel("unknown", "task"), "기타 상태");
});

test("settings pages no longer expose requested English and code labels", async () => {
  const [settings, monitoring] = await Promise.all([
    read("components/settings-workspaces.tsx"),
    read("components/monitoring-workspace.tsx"),
  ]);
  for (const legacy of [
    "Vercel Production Secret",
    "finance_access 또는 관리자",
    "RLS로 비활성 계정 차단",
    "One Brain · Many Channels",
    "사진 OCR",
    "화이트리스트 + 관리자 승인",
  ]) assert.doesNotMatch(settings, new RegExp(legacy));
  assert.doesNotMatch(monitoring, /RLS 기반 운영 기록 접근|Agent PAT 정본 읽기 전용/);
  assert.match(settings, /roleLabel\(member\.role\)/);
  assert.match(settings, /operatingStatusLabel\(brand\.status\)/);
});

test("mobile navigation includes settings and company settings link to canonical editors", async () => {
  const [shell, css, settings] = await Promise.all([
    read("components/app-shell.tsx"),
    read("app/globals.css"),
    read("components/settings-workspaces.tsx"),
  ]);
  assert.match(shell, /NAV_STAGES\.map/);
  assert.doesNotMatch(shell, /NAV_STAGES\.slice\(0, 5\)/);
  assert.match(css, /mobile-stage-bar[^}]*grid-template-columns: repeat\(6,1fr\)/);
  assert.match(settings, /href="\/organization\/members"/);
  assert.match(settings, /href="\/home\/goals"/);
  assert.match(settings, /이번 달 매출 목표/);
});

test("sensitive access gaps, shared knowledge categories and action confirmations are explicit", async () => {
  const [settings, knowledge, monitoring, categories] = await Promise.all([
    read("components/settings-workspaces.tsx"),
    read("components/knowledge-workspace.tsx"),
    read("components/monitoring-workspace.tsx"),
    read("lib/company-settings.ts"),
  ]);
  assert.match(settings, /SENSITIVE_ACCESS_ROSTER\.map/);
  assert.match(settings, /초대 대기/);
  assert.match(knowledge, /KNOWLEDGE_CATEGORIES\.map/);
  assert.match(knowledge, /knowledge-category-options/);
  assert.match(categories, /회사 공통/);
  assert.equal((monitoring.match(/window\.confirm/g) ?? []).length, 2);
  assert.match(monitoring, /지식 문서 최대 25건/);
  assert.match(monitoring, /텔레그램 웹훅을 운영 주소에 연결하거나 갱신/);
});
