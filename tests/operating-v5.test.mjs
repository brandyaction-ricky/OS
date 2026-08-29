import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("fifth handoff exposes seven content pages and six settings pages", async () => {
  const [navigation, router, settings] = await Promise.all([
    read("lib/navigation.ts"), read("app/(os)/[stage]/[page]/page.tsx"), read("components/settings-workspaces.tsx"),
  ]);
  for (const label of ["주제·기획", "원고·스크립트", "제목·썸네일", "숏폼 편집", "발행·업로드", "유튜브 관리", "영상 성과"]) assert.match(navigation, new RegExp(label));
  for (const route of ["connections", "access", "company", "channels"]) assert.match(router, new RegExp(`SettingsWorkspace page=\\"${route}\\"`));
  for (const label of ["Supabase", "Vercel", "OpenAI", "Telegram", "Meta·Google Ads", "지식 분류 8종"]) assert.match(settings, new RegExp(label));
});

test("content generation reads canonical procedures and waits safely for credentials", async () => {
  const route = await read("app/api/v1/content/generate/route.ts");
  assert.match(route, /eq\("status", "canonical"\)/);
  assert.match(route, /queueForCredentials/);
  assert.match(route, /자가검수|score와 review/);
  assert.match(route, /finalApprovalRequired: true/);
  assert.doesNotMatch(route, /youtube.*upload|threads.*publish|campaigns:mutate/i);
});

test("publishing and shorts enforce human gates before external work", async () => {
  const [records, generation, studio, automation] = await Promise.all([
    read("app/api/v1/records/route.ts"), read("app/api/v1/content/generate/route.ts"), read("components/content-studio-workspaces.tsx"), read("components/content-automation-workspace.tsx"),
  ]);
  assert.match(records, /CONTENT_PUBLISH_TRANSITIONS/);
  assert.match(records, /CONTENT_APPROVAL_REQUIRED/);
  assert.match(generation, /proposalOnly: true/);
  assert.match(studio, /renderState: "queued"/);
  assert.match(automation, /검토 완료/);
  assert.match(automation, /최종 승인·예약/);
});
