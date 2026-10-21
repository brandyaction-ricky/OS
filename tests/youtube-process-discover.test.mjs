import assert from "node:assert/strict";
import test from "node:test";
import { ageLabel, categoryQuery, channelNormal, durationLabel, isBreakout, nicheStage, NOT_A_TOPIC } from "../lib/youtube-process/discover.ts";

// 주제 찾기 (owner decision 2026-10-21, the 기획실 concept): a video breaks out against its own channel's normal views.
const upload = (views, durationSeconds = 600, title = "영상") => ({ views, durationSeconds, title });
const video = (viewCount, median, durationSeconds = 600, title = "영상") => ({ viewCount, median, ratio: median ? viewCount / median : null, durationSeconds, title });

test("a category searches its words with OR; multi-word ones stay together", () => {
  assert.equal(categoryQuery("A"), '"강점 찾기"|"재능 찾는 법"|"잘하는 일 찾기"');
  assert.equal(categoryQuery("G"), '번아웃|자존감|"일하기 싫을 때"');
});

test("a channel's normal is the median of five or more long uploads; Shorts and short videos do not count", () => {
  assert.equal(channelNormal([upload(1000), upload(2000), upload(3000), upload(4000), upload(100_000), upload(9, 50), upload(9, 600, "하루 루틴 #shorts")]), 3000);
  assert.equal(channelNormal([upload(1000), upload(2000), upload(3000), upload(4000), upload(5000, 100)]), null);
});

test("터진 영상: twice the channel's normal, 5,000 views, a normal of 1,000 and four minutes", () => {
  assert.equal(isBreakout(video(10_000, 5_000)), true);
  assert.equal(isBreakout(video(9_999, 5_000)), false);
  assert.equal(isBreakout(video(4_000, 1_000)), false, "under 5,000 views");
  assert.equal(isBreakout(video(9_000, 900)), false, "a normal under 1,000 makes the multiple meaningless");
  assert.equal(isBreakout(video(50_000, 5_000, 200)), false, "shorter than four minutes");
  assert.equal(isBreakout(video(50_000, null)), false, "unknown normal");
});

test("the same formula at 3 different channels is 확인된 주제, 2 is 지켜보는 것, 1 is 혼자 터뜨린 것", () => {
  assert.deepEqual([4, 3, 2, 1].map(nicheStage), ["confirmed", "confirmed", "watch", "solo"]);
  assert.equal(ageLabel(new Date(Date.now() - 40 * 86_400_000).toISOString()), "1개월 전");
});

test("background sound and music are not topics; long videos show hours", () => {
  assert.deepEqual(["relaxing rain sounds☔ - 빗소리 8시간 수면용 백색소음 ASMR", "공부할 때 듣는 플레이리스트", "단점이 강점이 되는 이유"].map(title => NOT_A_TOPIC.test(title)), [true, true, false]);
  assert.deepEqual([durationLabel(28801), durationLabel(1587)], ["8:00:01", "26:27"]);
});
