import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("content pages use the full screenshot-matched workspaces", async () => {
  const [router, radar, packaging, shorts, performance] = await Promise.all([
    read("app/(os)/[stage]/[page]/page.tsx"),
    read("components/content-radar-workspace.tsx"),
    read("components/content-packaging-workspace.tsx"),
    read("components/content-shortform-workspace.tsx"),
    read("components/content-performance-dashboard.tsx"),
  ]);
  for (const file of ["content-radar-workspace", "content-packaging-workspace", "content-shortform-workspace", "content-performance-dashboard"]) assert.match(router, new RegExp(file));
  for (const label of ["채널 탐색 사전", "터진 영상 발굴", "틈새 후보", "기획으로 넘기기"]) assert.match(radar, new RegExp(label));
  for (const label of ["우리 채널 썸네일", "시장 썸네일 검색", "제목 후보", "디자인 프롬프트", "저장한 시장 레퍼런스"]) assert.match(packaging, new RegExp(label));
  for (const label of ["스타일 템플릿", "세로 영상 미리보기", "수동 구간", "제작 요청"]) assert.match(shorts, new RegExp(label));
  for (const label of ["기여 매출", "콘텐츠 전환 퍼널", "일별 조회 흐름", "패키징 점검"]) assert.match(performance, new RegExp(label));
});

test("channel collection resolves an exact YouTube identity before saving", async () => {
  const [route, client, radar] = await Promise.all([
    read("app/api/v1/youtube/channel/route.ts"),
    read("lib/api-client.ts"),
    read("components/content-radar-workspace.tsx"),
  ]);
  assert.match(route, /forHandle/);
  assert.match(route, /UC\[\\w-\]\{22\}/);
  assert.match(route, /authenticateRequest/);
  assert.match(route, /process\.env\.YOUTUBE_API_KEY/);
  assert.doesNotMatch(route, /search\?part|type=channel/);
  assert.match(client, /resolveYoutubeChannel/);
  assert.match(radar, /채널 확인/);
  assert.match(radar, /verifiedChannel/);
});

test("content media uses private signed uploads and expires original files", async () => {
  const [migration, route, client, cleanup, cron, shorts] = await Promise.all([
    read("supabase/migrations/202608300008_content_media.sql"),
    read("app/api/v1/content/media/route.ts"),
    read("lib/api-client.ts"),
    read("lib/server/content-media.ts"),
    read("app/api/v1/indexing/cron/route.ts"),
    read("components/content-shortform-workspace.tsx"),
  ]);
  assert.match(migration, /'os-content-media'/);
  assert.match(migration, /public\s*=\s*false/);
  assert.match(route, /createSignedUploadUrl/);
  assert.match(route, /authenticateRequest/);
  assert.match(route, /5 \* 1024 \* 1024 \* 1024/);
  assert.doesNotMatch(route, /formData\(\)|\.upload\(path, file/);
  assert.match(client, /uploadToSignedUrl/);
  assert.match(cleanup, /contentMediaRetentionUntil/);
  assert.match(cleanup, /storage\.from\(BUCKET\)\.remove/);
  assert.match(cron, /cleanupExpiredContentMedia/);
  assert.match(shorts, /contentMediaPath/);
  assert.match(shorts, /retentionHours/);
});

test("publishing keeps review, calendar and SEO editing in one operating flow", async () => {
  const [automation, calendar] = await Promise.all([
    read("components/content-automation-workspace.tsx"),
    read("components/publishing-calendar-workspace.tsx"),
  ]);
  for (const label of ["검토 대기목록", "발행 캘린더", "파생 제작 현황", "칼럼 편집", "HTML 복사", "이미지 자리"]) assert.match(automation, new RegExp(label));
  assert.match(automation, /sandbox=""/);
  assert.doesNotMatch(automation, /dangerouslySetInnerHTML/);
  assert.match(calendar, /href="\/content\/publishing"/);
});
