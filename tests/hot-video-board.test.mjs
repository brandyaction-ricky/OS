import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("hot video board is connected to authenticated API, daily worker and evidence save flow", async () => {
  const [component, workspace, route, observer, server, helpers] = await Promise.all([
    read("components/hot-video-board.tsx"),
    read("components/content-radar-workspace.tsx"),
    read("app/api/v1/youtube/hot-videos/route.ts"),
    read("app/api/v1/youtube/observe/route.ts"),
    read("lib/server/hot-video-board.ts"),
    read("lib/hot-video-board.ts"),
  ]);
  for (const label of ["지금 반응이 터지는 영상", "한국", "미국", "성과", "노출 속도", "기여도", "전일 버튼으로 과거 스냅숏"]) assert.match(component, new RegExp(label));
  assert.match(workspace, /discoverySource.*hot_video/);
  assert.match(route, /authenticateRequest/);
  assert.match(route, /ADMIN_REQUIRED/);
  assert.match(observer, /collectHotVideoBoards/);
  assert.match(server, /mostPopular/);
  assert.match(server, /publishedAfter/);
  assert.match(server, /packageKind: "hot_video_board"/);
  assert.match(server, /subscriberCount/);
  assert.match(helpers, /if \(durationSeconds <= 60\) return "short"/);
  assert.match(helpers, /if \(durationSeconds < 240\) return "reference"/);
  assert.match(helpers, /return \{ id: "other", name: "기타" \}/);
  assert.match(helpers, /performance: baseline && baseline > 0/);
  assert.match(helpers, /contribution: input\.subscribers/);
  assert.match(helpers, /exposureVelocity: momentum\.velocity/);
  assert.match(helpers, /regionCount \* 101/);
});
