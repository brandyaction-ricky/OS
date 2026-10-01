import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  appendHotVideoSnapshot,
  buildHotVideoScores,
  classifyHotVideo,
  hotVideoFormat,
  hotVideoQuotaEstimate,
  scoreLabel,
  seoulDate,
} from "../lib/hot-video-board.ts";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("hot video helpers preserve the agreed formats, labels, categories and KST day", () => {
  assert.equal(hotVideoFormat(60), "short");
  assert.equal(hotVideoFormat(61), "reference");
  assert.equal(hotVideoFormat(239), "reference");
  assert.equal(hotVideoFormat(240), "long");
  assert.equal(classifyHotVideo("직장인 커리어 전환").id, "C");
  assert.equal(classifyHotVideo("unrelated music chart").id, "other");
  assert.equal(scoreLabel(null), "집계 중");
  assert.equal(scoreLabel(4), "Great");
  assert.equal(seoulDate(new Date("2026-09-30T15:30:00.000Z")), "2026-10-01");
  assert.deepEqual(hotVideoQuotaEstimate(2, 12), {
    dailyUnits: 350,
    discoveryUnits: 206,
    maximumBaselineUnits: 144,
    detail: "지역 2곳 × 발견 103 + 후보 12개 × 채널 기준선 최대 6",
  });
});

test("hot video scoring reuses the 20-video baseline and three-snapshot momentum", () => {
  const target = { id: "target", channelId: "channel", title: "target", publishedAt: "2026-09-21T00:00:00Z", views: 500, durationSeconds: 600 };
  const peers = Array.from({ length: 20 }, (_, index) => ({ id: `peer-${index}`, channelId: "channel", title: `peer ${index}`, publishedAt: "2026-09-20T00:00:00Z", views: 100, durationSeconds: 600 }));
  const snapshots = [
    { views: 100, measuredAt: "2026-10-01T00:00:00Z" },
    { views: 200, measuredAt: "2026-10-01T01:00:00Z" },
    { views: 400, measuredAt: "2026-10-01T02:00:00Z" },
  ];
  const scores = buildHotVideoScores({ target, channelVideos: peers, subscribers: 1_000, snapshots, now: Date.parse("2026-10-01T00:00:00Z") });
  assert.equal(scores.performanceState, "measured");
  assert.equal(scores.performanceSampleCount, 20);
  assert.equal(scores.performance, 5);
  assert.equal(scores.performanceBaselineViews, 100);
  assert.equal(scores.contribution, 0.5);
  assert.equal(scores.momentumState, "measured");
  assert.equal(scores.exposureVelocity, 200);
  assert.equal(scores.exposureAcceleration, 100);
});

test("snapshot history is ordered, de-duplicated and bounded to three measurements", () => {
  const value = appendHotVideoSnapshot([
    { views: 10, measuredAt: "2026-10-01T00:00:00Z" },
    { views: 20, measuredAt: "2026-10-01T01:00:00Z" },
    { views: 30, measuredAt: "2026-10-01T02:00:00Z" },
  ], { views: 40, measuredAt: "2026-10-01T03:00:00Z" });
  assert.deepEqual(value.map((item) => item.views), [20, 30, 40]);
});

test("hot video board is connected to auth, daily discovery, hourly refresh, failure records and evidence save", async () => {
  const [component, workspace, route, observer, server] = await Promise.all([
    read("components/hot-video-board.tsx"),
    read("components/content-radar-workspace.tsx"),
    read("app/api/v1/youtube/hot-videos/route.ts"),
    read("app/api/v1/youtube/observe/route.ts"),
    read("lib/server/hot-video-board.ts"),
  ]);
  for (const label of ["지금 반응이 터지는 영상", "한국", "미국", "성과", "노출 속도", "기여도", "전일", "수집 실패"]) assert.match(component, new RegExp(label));
  assert.match(component, /\["long", "reference"\]/);
  assert.match(workspace, /discoverySource.*hot_video/);
  assert.match(workspace, /hotVideoEvidence/);
  assert.match(route, /authenticateRequest/);
  assert.match(route, /ADMIN_REQUIRED/);
  assert.match(route, /force: true/);
  assert.match(observer, /collectHotVideoBoards/);
  assert.match(server, /mostPopular/);
  assert.match(server, /publishedAfter/);
  assert.match(server, /refreshRegion/);
  assert.match(server, /packageKind: "hot_video_board"/);
  assert.match(server, /failure: reason/);
  assert.match(server, /archiveExpiredBoards/);
  assert.match(server, /HOT_VIDEO_CANDIDATE_LIMIT/);
});
