import assert from "node:assert/strict";
import test from "node:test";
import { ageLabel, categoryQuery, nicheThemes, titleWords } from "../lib/youtube-process/discover.ts";

// 주제 찾기 (owner request 2026-10-21): niche topics are the words shared by videos watched beyond their channel's subscribers.
const video = (id, title, ratio) => ({ id, title, channelTitle: "c", viewCount: 1, subscribers: 1, viewSubscriberRatio: ratio, durationSeconds: 600, publishedAt: null, thumbnail: "", url: "" });

test("a category searches its words with OR; multi-word ones stay together", () => {
  assert.equal(categoryQuery("A"), '"강점 찾기"|재능|"잘하는 것"');
});

test("title words drop particles, brackets and filler words", () => {
  assert.deepEqual(titleWords("[강연] 단점이 오히려 강점이 되는 이유 (feat. 심리학)"), ["단점", "오히려", "강점"]);
});

test("niche themes count only videos above the ratio and need two of them; most shared first, then the higher average", () => {
  const themes = nicheThemes([video("a", "단점이 강점이 된다", 4), video("b", "단점을 고치지 마세요", 2), video("c", "강점 찾는 법", 3), video("d", "단점 이야기", 0.5)]);
  assert.deepEqual(themes.map(theme => [theme.word, theme.count, theme.avgRatio]), [["강점", 2, 3.5], ["단점", 2, 3]]);
  assert.equal(ageLabel(new Date(Date.now() - 40 * 86_400_000).toISOString()), "1개월 전");
});

test("background sound and music are not topics; long videos show hours", async () => {
  const { NOT_A_TOPIC, durationLabel } = await import("../lib/youtube-process/discover.ts");
  assert.deepEqual(["relaxing rain sounds☔ - 빗소리 8시간 수면용 백색소음 ASMR", "공부할 때 듣는 플레이리스트", "단점이 강점이 되는 이유"].map(title => NOT_A_TOPIC.test(title)), [true, true, false]);
  assert.deepEqual([durationLabel(28801), durationLabel(1587)], ["8:00:01", "26:27"]);
});
