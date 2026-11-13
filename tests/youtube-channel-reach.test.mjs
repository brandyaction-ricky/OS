import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseReachCsv, reachPercent } from "../lib/youtube-channel-analytics.ts";
import { summarizeDayRows, videoRows } from "../lib/content-metric-summary.ts";

// 노출 · 클릭률 (2026-11-13): YouTube Reporting Reach reports onto the Analytics day rows.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const csv = "date,channel_id,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\n20261110,UC1,vid1,1000,0.052\n20261110,UC1,vid2,200,0.01\n20261111,UC1,vid1,0,\nbad,UC1,vid3,5,0.1\n";

test("a Reach report becomes one row per video and day; a fractional CTR is read as percent", () => {
  const rows = reachPercent(parseReachCsv(csv));
  assert.deepEqual(rows.map((r) => [r.day, r.video, r.impressions, r.ctr]), [["2026-11-10", "vid1", 1000, 5.2], ["2026-11-10", "vid2", 200, 1], ["2026-11-11", "vid1", 0, null]]);
  const percent = reachPercent(parseReachCsv(csv.replace("0.052", "5.2").replace(",0.01", ",1")));
  assert.equal(percent[0].ctr, 5.2, "a report already in percent stays as it is");
  assert.deepEqual(parseReachCsv("date,video_id\n20261110,v"), [], "no impressions column, nothing read");
});

test("impressions add up and CTR is weighted by impressions, per video", () => {
  const row = (day, impressions, ctr) => ({ id: day, title: "영상", source_url: null, starts_at: `${day}T12:00:00Z`, created_at: `${day}T12:00:00Z`,
    metadata: { contentId: "vid1", day, format: "long", views: 10, impressions, ctr, dataSource: "youtube_analytics_daily" } });
  const [record] = videoRows(summarizeDayRows([row("2026-11-10", 1000, 5), row("2026-11-11", 3000, 1)]).videos);
  assert.equal(record.metadata.impressions, 4000);
  assert.equal(record.metadata.ctr, 2, "(1000×5 + 3000×1) / 4000");
});

test("the Reach job keeps one reporting job per channel, reads recent reports oldest first and never loses reach on re-reads", () => {
  const job = read("lib/server/youtube-channel-reach.ts");
  assert.match(job, /REPORT_TYPE = "channel_reach_basic_a1"/);
  assert.match(job, /method: "POST", body: JSON\.stringify\(\{ reportTypeId: REPORT_TYPE/);
  assert.match(job, /new URLSearchParams\(\{ createdAfter/);
  assert.match(job, /reports\.sort\(\(a, b\) => a\.createTime\.localeCompare\(b\.createTime\)\)/);
  assert.match(job, /reporting<string>\(report\.downloadUrl, token, undefined, true\)/, "the report is read as text");
  assert.match(job, /COLUMNS\.map\(\(column\) => \[column, kept\[column\]\]\)/, "an existing row is rewritten only in the job's own columns");
  assert.match(read("lib/server/youtube-channel-analytics.ts"), /select\("id, impressions:metadata->impressions, ctr:metadata->ctr"\)/, "the Analytics re-read keeps impressions and CTR");
  const route = read("app/api/v1/content/channel-reach/route.ts");
  assert.match(route, /safeSecretMatch\(received, expected\)/);
  assert.match(route, /syncChannelReach\(new Date\(\)\)/);
  const vercel = JSON.parse(read("vercel.json"));
  assert.ok(vercel.crons.some((c) => c.path === "/api/v1/content/channel-reach" && c.schedule === "55 21 * * *"));
  assert.equal(vercel.functions["app/api/v1/content/channel-reach/route.ts"].maxDuration, 300);
  const sql = read("supabase/migrations/20261113090000_content_metric_summary_reach.sql");
  assert.match(sql, /'ctrSum', sum\(ctr \* impressions\) filter \(where ctr is not null and impressions > 0\)/);
  assert.match(sql, /security invoker/);
});
