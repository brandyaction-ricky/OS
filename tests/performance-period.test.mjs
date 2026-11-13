import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { changeLabel, periodRange, previousRange, rangeLabel, readPeriod, spanDays, youtubeFormat } from "../lib/performance-period.ts";

// 영상 성과 기간 (2026-11-12): presets in Korean days, the span before for 「직전 7일보다」, 롱폼/숏폼 of a row.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const at = (search) => ({ get: (name) => new URLSearchParams(search).get(name) });

test("each preset covers the right Korean days, both ends kept", () => {
  const today = "2026-11-12";
  assert.deepEqual(periodRange("today", today), { from: "2026-11-12", to: "2026-11-12" });
  assert.deepEqual(periodRange("yesterday", today), { from: "2026-11-11", to: "2026-11-11" });
  assert.deepEqual(periodRange("3d", today), { from: "2026-11-10", to: "2026-11-12" });
  assert.deepEqual(periodRange("7d", today), { from: "2026-11-06", to: "2026-11-12" });
  assert.equal(spanDays(...Object.values(periodRange("30d", today))), 30);
  assert.deepEqual(periodRange("month", today), { from: "2026-11-01", to: "2026-11-12" });
  assert.deepEqual(periodRange("lastMonth", today), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(periodRange("lastMonth", "2026-03-05"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(periodRange("lastMonth", "2026-01-10"), { from: "2025-12-01", to: "2025-12-31" });
});

test("the address picks the period; a broken custom range falls back to 최근 30일", () => {
  assert.deepEqual(readPeriod(at("period=7d"), "2026-11-12"), { id: "7d", from: "2026-11-06", to: "2026-11-12" });
  assert.deepEqual(readPeriod(at("period=custom&from=2026-10-03&to=2026-10-09"), "2026-11-12"), { id: "custom", from: "2026-10-03", to: "2026-10-09" });
  assert.equal(readPeriod(at("period=custom&from=2026-10-09&to=2026-10-03"), "2026-11-12").id, "30d");
  assert.equal(readPeriod(at("period=nonsense"), "2026-11-12").id, "30d");
  assert.equal(readPeriod(at(""), "2026-11-12").from, "2026-10-14");
});

test("the comparison span is the same number of days right before, and a change is never invented", () => {
  assert.deepEqual(previousRange("2026-11-06", "2026-11-12"), { from: "2026-10-30", to: "2026-11-05", days: 7 });
  assert.deepEqual(previousRange("2026-11-12", "2026-11-12"), { from: "2026-11-11", to: "2026-11-11", days: 1 });
  assert.deepEqual(changeLabel(112, 100), { text: "▲ 12%", tone: "up" });
  assert.deepEqual(changeLabel(90, 100), { text: "▼ 10%", tone: "down" });
  assert.deepEqual(changeLabel(41.5, 40, true), { text: "▲ 1.5%p", tone: "up" });
  assert.equal(changeLabel(100, null), null, "nothing before is no comparison, not 0%");
  assert.equal(changeLabel(5, 0), null, "from zero there is no percentage");
  assert.equal(rangeLabel("2026-11-12", "2026-11-12"), "11월 12일 (목)");
  assert.equal(rangeLabel("2026-11-06", "2026-11-12"), "11월 6일 (금) ~ 11월 12일 (목) · 7일");
});

test("롱폼/숏폼 follows the row's format, its platform name, then the 3-minute limit", () => {
  assert.equal(youtubeFormat({ platform: "YouTube", format: "shorts" }), "shorts");
  assert.equal(youtubeFormat({ platform: "YouTube Shorts" }), "shorts");
  assert.equal(youtubeFormat({ platform: "yt_shorts" }), "shorts");
  assert.equal(youtubeFormat({ platform: "YouTube", durationSeconds: 58 }), "shorts");
  assert.equal(youtubeFormat({ platform: "YouTube", durationSeconds: 900 }), "long");
  assert.equal(youtubeFormat({ platform: "YouTube", format: "long" }), "long");
});

test("the screen keeps the period and tab in the address and every tab reads the same filtered rows", () => {
  const page = read("components/content-performance-dashboard.tsx");
  assert.match(page, /period = readPeriod\(search, today\)/);
  assert.match(page, /router\.replace\(next\.size \? `\$\{pathname\}\?\$\{next\}` : pathname, \{ scroll: false \}\)/);
  assert.match(page, /PERIODS\.map\(\(item\) => <button type="button" key=\{item\.id\} className="os-chip" aria-pressed=\{period\.id === item\.id\}/);
  assert.match(page, /className="page-tab" aria-selected=\{tab === id\}/);
  assert.match(page, /listMetricSummary\(accessToken, prev\.from, prev\.to, observed\)/, "the span before is read for 「직전 n일보다」");
  assert.match(page, /youtubeFormat\(item\.metadata\) === format/);
  assert.match(read("lib/api-client.ts"), /return periodRange\(DEFAULT_PERIOD, kstDay\(new Date\(now\)\)\)!;/, "the early read asks for the period the screen opens on");
  assert.doesNotMatch(read("components/performance-daily-chart.tsx"), /style=\{\{/);
});
