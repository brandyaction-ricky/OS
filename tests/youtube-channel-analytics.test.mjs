import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { addDays, dayFields, dueYtSnapshots, hasActivity, parseYtDays, ptDay, ytFormat, ytSnapshot } from "../lib/youtube-channel-analytics.ts";

// 영상 성과 채우기 (2026-11-11): every channel video day by day from YouTube Analytics.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const headers = ["day", "views", "likes", "averageViewDuration", "averageViewPercentage", "subscribersGained", "subscribersLost"].map((name) => ({ name }));

test("a day report becomes one object per day; a missing or odd value stays missing, never zero", () => {
  const days = parseYtDays(headers, [["2026-11-01", 100, 5, 60, 40, 3, 1], ["2026-11-02", 50, null, 30, 20, 0, 0], ["bad", 1, 1, 1, 1, 1, 1]]);
  assert.equal(days.length, 2);
  assert.equal(days[1].likes, undefined);
  assert.deepEqual({ views: dayFields(days[0]).views, retention: dayFields(days[0]).retention, subscribers: dayFields(days[0]).subscribers }, { views: 100, retention: 40, subscribers: 2 });
  assert.deepEqual(parseYtDays([], []), []);
});

test("D1/D7/D28 add up the first N+1 Pacific days, weight averages by views, and wait until the days have settled", () => {
  const days = Array.from({ length: 40 }, (_, i) => ({ day: addDays("2026-10-01", i), views: 10, averageViewPercentage: i === 0 ? 50 : 30, subscribersGained: 1, subscribersLost: 0 }));
  const d1 = ytSnapshot(days, "2026-10-01", "d1");
  assert.equal(d1.views, 20);
  assert.equal(d1.averageViewPercentage, 40);
  assert.equal(ytSnapshot(days, "2026-10-01", "d7").views, 80);
  assert.equal(ytSnapshot(days, "2026-10-01", "d28").subscribersGained, 29);
  assert.equal(ytSnapshot([], "2026-10-01", "d1"), null, "no days is not zero views");
  assert.deepEqual(dueYtSnapshots("2026-10-01", "2026-10-04"), []);
  assert.deepEqual(dueYtSnapshots("2026-10-01", "2026-10-05"), ["d1"]);
  assert.deepEqual(dueYtSnapshots("2026-10-01", "2026-10-31"), ["d1", "d7"]);
  assert.deepEqual(dueYtSnapshots("2026-10-01", "2026-11-01"), ["d1", "d7", "d28"]);
  assert.equal(ptDay("2026-11-11T05:00:00Z"), "2026-11-10", "Analytics counts Pacific days");
  assert.equal(ytFormat(58), "shorts");
  assert.equal(ytFormat(900), "long");
});

test("the daily job reads every upload, writes daily rows that stand in for the hourly totals, and takes over YouTube snapshots", () => {
  const job = read("lib/server/youtube-channel-analytics.ts");
  assert.match(job, /playlistItems\?/);
  assert.match(job, /nextPageToken/);
  assert.match(job, /platform: "YouTube", format, metricMode: "daily", dataSource: DAILY/);
  assert.match(job, /channelSnapshotVersion: 1, source: "api", snapshot, platform, publishId: video\.id/);
  assert.match(job, /upsert\(snapRows, \{ onConflict: "id", ignoreDuplicates: true \}\)/);
  assert.match(read("lib/server/channel-metrics.ts"), /if\(providerPlatform==="youtube"\)continue;/);
  const route = read("app/api/v1/content/channel-analytics/route.ts");
  assert.match(route, /safeSecretMatch\(received, expected\)/);
  assert.match(route, /!settings\.autoCollect \|\| !settings\.enabledChannels\.includes\("youtube"\)/);
  const vercel = JSON.parse(read("vercel.json"));
  assert.ok(vercel.crons.some((c) => c.path === "/api/v1/content/channel-analytics"));
  assert.equal(vercel.functions["app/api/v1/content/channel-analytics/route.ts"].maxDuration, 300);
});

test("a day with nothing on it is not stored as a row", () => {
  assert.equal(hasActivity({ day: "2026-11-01", views: 0, likes: 0, subscribersGained: 0, subscribersLost: 0, averageViewPercentage: 0 }), false);
  assert.equal(hasActivity({ day: "2026-11-01", views: 0, subscribersGained: 1 }), true);
  assert.equal(hasActivity({ day: "2026-11-01", views: 3 }), true);
  assert.match(readFileSync(new URL("../lib/server/youtube-channel-analytics.ts", import.meta.url), "utf8"), /d\.views != null && hasActivity\(d\)/);
});
