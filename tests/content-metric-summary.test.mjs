import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { summarizeDayRows, videoRows, viewsByDay } from "../lib/content-metric-summary.ts";

// 영상 성과 under a second (2026-11-12): YouTube Analytics day rows arrive added up per day and per video.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const row = (video, day, format, views, retention, subscribers = 0) => ({ id: `${video}-${day}`, title: `영상 ${video}`, source_url: `https://youtu.be/${video}`, starts_at: `${day}T12:00:00Z`, created_at: `${day}T12:00:00Z`,
  metadata: { contentId: video, day, format, views, retention, subscribers, dataSource: "youtube_analytics_daily", metricMode: "daily", platform: "YouTube" } });

test("day rows add up per day and per video; retention is weighted by views and a missing value stays missing", () => {
  const { days, videos } = summarizeDayRows([row("a", "2026-11-01", "long", 100, 40, 2), row("a", "2026-11-02", "long", 300, 20, 1), row("b", "2026-11-01", "shorts", 50, null)]);
  const a = videos.find((v) => v.video === "a");
  assert.equal(a.views, 400); assert.equal(a.days, 2); assert.equal(a.lastDay, "2026-11-02"); assert.equal(a.subscribers, 3);
  assert.equal(a.retentionSum / a.retentionViews, 25, "(100×40 + 300×20) / 400");
  const b = videos.find((v) => v.video === "b");
  assert.equal(b.retentionViews, null, "no retention is not 0%");
  assert.equal(days.length, 3);
  assert.deepEqual([...viewsByDay(days, "all")], [["2026-11-01", 150], ["2026-11-02", 300]]);
  assert.deepEqual([...viewsByDay(days, "shorts")], [["2026-11-01", 50]]);
});

test("one read-only record per video carries its sums for the page's cards and tables", () => {
  const [record] = videoRows(summarizeDayRows([row("a", "2026-11-01", "long", 100, 40), row("a", "2026-11-03", "long", 300, 20)]).videos);
  assert.equal(record.id, "summary-a-long");
  assert.equal(record.starts_at, "2026-11-03T12:00:00Z");
  assert.equal(record.metadata.summary, true);
  assert.equal(record.metadata.metricMode, "daily");
  assert.equal(record.metadata.views, 400);
  assert.equal(record.metadata.retention, 25);
  assert.equal(record.metadata.days, 2);
});

test("the page reads one small summary per period; the database adds up with partial indexes and the caller's policies", () => {
  const route = read("app/api/v1/content/metrics/summary/route.ts");
  assert.match(route, /actor\.supabase\.rpc\("os_content_metric_summary", \{ \.\.\.window, p_observed: observed \}\)/);
  assert.match(route, /error\.code === "PGRST202"/, "until the migration is in, the route adds up the window rows itself");
  const sql = read("supabase/migrations/20261112230000_content_metric_summary.sql");
  assert.match(sql, /create index if not exists os_records_metric_daily_idx on public\.os_records \(\(metadata->>'day'\)\)/);
  assert.match(sql, /create index if not exists os_records_metric_other_idx/);
  assert.match(sql, /security invoker/);
  assert.match(sql, /where p_observed and r\.record_type = 'content_metric'/, "hourly tracked-channel rows only when asked");
  assert.match(sql, /revoke all on function public\.os_content_metric_summary\(timestamptz, timestamptz, boolean\) from public, anon/);
  assert.match(read("supabase/rollback/20261112230000_content_metric_summary.down.sql"), /drop function if exists public\.os_content_metric_summary/);
  const page = read("components/content-performance-dashboard.tsx");
  assert.match(page, /listMetricSummary\(accessToken, from, to, observed\)/);
  assert.match(page, /const observed = origin !== "own";/);
  assert.match(page, /viewsByDay\(days, format\)/);
  assert.match(read("lib/api-client.ts"), /return metricSummaryPath\(from, to\);/, "the early read asks for the same summary");
  assert.match(read("lib/content-metrics.ts"), /count: group\.reduce\(\(n, record\) => n \+ \(Number\(record\.metadata\.days\) \|\| 1\), 0\)/);
});
