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
  assert.match(route, /output_config/);
  assert.match(route, /json_schema/);
  assert.match(route, /CLAUDE_OUTPUT_TRUNCATED/);
  assert.doesNotMatch(route, /minimum:|maximum:/);
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

test("content studio ports planning, eight-step scripts and channel judgment", async () => {
  const [router, pipeline, generation, packageWorkspace] = await Promise.all([
    read("app/(os)/[stage]/[page]/page.tsx"),
    read("components/content-pipeline-workspaces.tsx"),
    read("app/api/v1/content/generate/route.ts"),
    read("components/content-studio-workspaces.tsx"),
  ]);
  for (const workspace of ["ContentTopicsWorkspace", "ContentScriptsWorkspace", "ContentPerformanceWorkspace"]) assert.match(router, new RegExp(workspace));
  for (const step of ["채널 모으기", "터진 영상 발굴", "틈새 확정", "축 확정", "설계표", "다듬기", "발행"]) assert.match(pipeline, new RegExp(step));
  for (const metric of ["CTR", "시청지속", "전환"]) assert.match(pipeline, new RegExp(metric));
  assert.match(generation, /topic_plan/);
  assert.match(generation, /script_draft/);
  assert.match(packageWorkspace, /candidate-pick/);
});

test("session QA keeps the five canonical derivative channels and editable publishing gates", async () => {
  const [generation, automation, studio] = await Promise.all([
    read("app/api/v1/content/generate/route.ts"),
    read("components/content-automation-workspace.tsx"),
    read("components/content-studio-workspaces.tsx"),
  ]);
  for (const platform of ["shorts", "threads", "column", "instagram", "essay"]) {
    assert.match(automation, new RegExp(`platform: \\"${platform}\\"`));
  }
  assert.match(generation, /deriv_html/);
  assert.match(automation, /승인완료 일괄 예약/);
  assert.match(automation, /type="datetime-local"/);
  assert.match(automation, /archiveRecord/);
  assert.match(studio, /키트 수정/);
  assert.match(studio, /수정 저장/);
});

test("YouTube market evidence stays server-side and feeds title packaging", async () => {
  const [route, client, studio, generation, health, settings] = await Promise.all([
    read("app/api/v1/youtube/search/route.ts"),
    read("lib/api-client.ts"),
    read("components/content-studio-workspaces.tsx"),
    read("app/api/v1/content/generate/route.ts"),
    read("app/api/v1/health/route.ts"),
    read("components/settings-workspaces.tsx"),
  ]);
  assert.match(route, /process\.env\.YOUTUBE_API_KEY/);
  assert.match(route, /authenticateRequest/);
  assert.doesNotMatch(route, /YOUTUBE_CLIENT_SECRET/);
  assert.match(client, /searchYoutubeMarket/);
  assert.match(studio, /YouTube 시장 검색/);
  assert.match(generation, /marketEvidence/);
  assert.match(health, /YOUTUBE_API_KEY/);
  assert.match(settings, /YouTube Data API/);
});

test("YouTube OAuth upload keeps tokens encrypted and requires an admin approval gate", async () => {
  const [migration, oauth, callback, session, complete, client, workspace, health] = await Promise.all([
    read("supabase/migrations/202608300007_youtube_oauth.sql"),
    read("app/api/v1/youtube/oauth/route.ts"),
    read("app/api/v1/youtube/oauth/callback/route.ts"),
    read("app/api/v1/youtube/upload/session/route.ts"),
    read("app/api/v1/youtube/upload/complete/route.ts"),
    read("lib/api-client.ts"),
    read("components/content-studio-workspaces.tsx"),
    read("app/api/v1/health/route.ts"),
  ]);
  assert.match(migration, /os_youtube_connections/);
  assert.match(migration, /revoke all.*authenticated/i);
  assert.match(oauth, /httpOnly: true/);
  assert.match(oauth, /sameSite: "lax"/);
  assert.match(callback, /verifyYoutubeOAuthState/);
  assert.match(session, /actor\.role !== "admin"/);
  assert.match(session, /finalApproval: z\.literal\(true\)/);
  assert.match(session, /uploadType: "resumable"/);
  assert.doesNotMatch(session, /YOUTUBE_CLIENT_SECRET/);
  assert.match(complete, /YOUTUBE_UPLOAD_OWNERSHIP_FAILED/);
  assert.match(client, /XMLHttpRequest/);
  assert.match(workspace, /Google 채널 연결/);
  assert.match(workspace, /최종 확인.*업로드를 승인/);
  assert.match(health, /youtubeOAuth/);
});

test("knowledge focus mode is persistent and project hub is removed from navigation", async () => {
  const [knowledge, shell, navigation, router, config] = await Promise.all([
    read("components/knowledge-workspace.tsx"),
    read("components/app-shell.tsx"),
    read("lib/navigation.ts"),
    read("app/(os)/[stage]/[page]/page.tsx"),
    read("lib/workspace-config.ts"),
  ]);
  assert.match(knowledge, /brandy-knowledge-focus/);
  assert.match(knowledge, /집중 모드/);
  assert.match(shell, /knowledge-focus/);
  assert.doesNotMatch(navigation, /프로젝트 관제/);
  assert.match(router, /redirect\("\/organization\/meetings"\)/);
  assert.doesNotMatch(config, /organization\/projects|AI PROJECT HUB|프로젝트 관제/);
});

test("non-content workspaces use everyday Korean labels and real team examples", async () => {
  const files = await Promise.all([
    "components/dashboard.tsx",
    "components/knowledge-search.tsx",
    "components/tasks-workspace.tsx",
    "components/meeting-workspace.tsx",
    "components/growth-dashboard.tsx",
    "components/performance-workspaces.tsx",
    "components/settings-workspaces.tsx",
    "components/members-workspace.tsx",
    "components/organization-v3-workspaces.tsx",
    "lib/workspace-config.ts",
  ].map(read));
  const source = files.join("\n");
  for (const oldLabel of [
    "WEEKLY COMMAND CENTER", "KNOWLEDGE SEARCH", "EXECUTION BOARD",
    "MEETING TO ACTION", "GROWTH COMMAND", "REVENUE CONTROL",
    "ACQUISITION FUNNEL", "WEEKLY SCORECARD", "COMMERCE ADMIN",
    "PEOPLE & ACCESS", "SYSTEM CONNECTIONS", "SYSTEM CONFIGURATION",
  ]) assert.doesNotMatch(source, new RegExp(oldLabel));
  assert.doesNotMatch(source, /데이빗|프로젝트 관제에서 요청서를/);
  assert.match(source, /예: 안저, 리키, 에릭/);
  assert.match(source, /AI 작업에서 요청서를 등록하면/);
});
