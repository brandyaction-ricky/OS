import assert from "node:assert/strict";
import test from "node:test";
import { outlierBaseline, youtubeAgeCheckpoint, youtubeFormatBucket } from "../lib/youtube-outliers.ts";

const now = Date.parse("2026-09-09T00:00:00Z");
const video = (id, views, durationSeconds = 900, ageDays = 10) => ({ id, channelId: "channel", title: `영상 ${id}`, publishedAt: new Date(now - ageDays * 86_400_000).toISOString(), views, durationSeconds });

test("company outliers compare the same channel, duration format and age window", () => {
  const peers = Array.from({ length: 20 }, (_, index) => video(`peer-${index}`, 100, 900, 8 + index / 10));
  const wrongFormat = Array.from({ length: 20 }, (_, index) => video(`short-long-${index}`, 1, 300, 9));
  const result = outlierBaseline(video("target", 400, 900, 10), [...peers, ...wrongFormat], now);
  assert.equal(result.sampleCount, 20);
  assert.equal(result.formatBucket, "12–30분");
  assert.equal(result.ratio, 4);
  assert.equal(result.outlier, true);
  assert.deepEqual(new Set(result.sampleIds), new Set(peers.map((item) => item.id)));
});

test("fixed checkpoint and format labels are explicit", () => {
  assert.equal(youtubeFormatBucket(239), null);
  assert.equal(youtubeFormatBucket(600), "4–12분");
  assert.equal(youtubeFormatBucket(1_200), "12–30분");
  assert.equal(youtubeAgeCheckpoint(video("seven", 1, 900, 7).publishedAt, now), "D+7");
  assert.equal(youtubeAgeCheckpoint(video("thirty", 1, 900, 30).publishedAt, now), "D+30");
  assert.equal(youtubeAgeCheckpoint(video("ninety", 1, 900, 90).publishedAt, now), "D+90");
});
