import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { attainmentPercent, averageAttainment, buildHomeRevenueView, groupHomeVideos } from "../lib/home-dashboard.ts";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const record = (input = {}) => ({
  id: crypto.randomUUID(), record_type: "kpi", title: "지표", description: "", status: "active", priority: "normal",
  stage: "", brand: "", team: "", owner_id: null, assignee_id: null, parent_id: null, due_date: null,
  starts_at: null, ends_at: null, progress: 100, metric_target: null, metric_current: null, metric_unit: "",
  amount: null, currency: "KRW", source_url: null, tags: [], metadata: {}, version: 1, created_by: "",
  updated_by: "", created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z", archived_at: null,
  ...input,
});

test("attainment calculations ignore records without a real baseline", () => {
  const unmeasured = record({ progress: 100 });
  const measured = record({ metric_target: 200, metric_current: 100 });
  assert.equal(attainmentPercent(unmeasured), null);
  assert.equal(attainmentPercent(measured), 50);
  assert.equal(averageAttainment([unmeasured, measured]), 50);
  assert.equal(averageAttainment([unmeasured]), null);
});

test("home revenue does not double-count imported net revenue", () => {
  const view = buildHomeRevenueView([
    record({ record_type: "revenue", brand: "마이인", amount: 100_000, metadata: { date: "2026-08-30", net: 100_000 }, updated_at: "2026-08-30T08:30:00.000Z" }),
    record({ record_type: "revenue", brand: "마이인", amount: 50_000, metadata: { date: "2026-08-20", net: 50_000 } }),
    record({ record_type: "revenue", brand: "마이인", amount: 50_000, metadata: { date: "2026-07-30", net: 50_000 } }),
    record({ record_type: "goal", title: "마이인 매출", brand: "마이인", metric_target: 30, metric_unit: "만원", metadata: { periodMonth: "2026-08" } }),
  ], new Date("2026-08-30T12:00:00.000Z"));
  assert.equal(view.myin.current, 150_000);
  assert.equal(view.myin.goal, 300_000);
  assert.equal(view.myin.monthChange, 200);
  assert.equal(view.myin.weekChange, 100);
  assert.equal(view.total.current, 150_000);
});

test("home revenue compares the same elapsed days of the previous month", () => {
  const view = buildHomeRevenueView([
    record({ record_type: "revenue", brand: "마이인", amount: 100_000, metadata: { date: "2026-09-01", net: 100_000 } }),
    record({ record_type: "revenue", brand: "마이인", amount: 50_000, metadata: { date: "2026-08-01", net: 50_000 } }),
    record({ record_type: "revenue", brand: "마이인", amount: 900_000, metadata: { date: "2026-08-31", net: 900_000 } }),
  ], new Date("2026-09-01T12:00:00.000Z"));
  assert.equal(view.myin.current, 100_000);
  assert.equal(view.myin.monthChange, 100);
});

test("home video grouping returns one row per content lineage", () => {
  const topic = record({ record_type: "content_topic", title: "같은 영상", brand: "마이인" });
  const videos = groupHomeVideos([
    topic,
    record({ record_type: "content_package", title: "같은 영상 · 제목·썸네일 후보", parent_id: topic.id, status: "review", metadata: { packageKind: "title_package" }, updated_at: "2026-08-02T00:00:00.000Z" }),
    record({ record_type: "content_package", title: "같은 영상 · 제목·썸네일 후보", parent_id: topic.id, status: "review", metadata: { packageKind: "title_package" }, updated_at: "2026-08-03T00:00:00.000Z" }),
    record({ record_type: "content_package", title: "같은 영상 · 유튜브 발행 키트", parent_id: topic.id, status: "review", metadata: { packageKind: "youtube_kit" }, updated_at: "2026-08-04T00:00:00.000Z" }),
    record({ record_type: "content_topic", title: "다른 영상", brand: "브랜디액션 에듀", updated_at: "2026-08-05T00:00:00.000Z" }),
  ]);
  assert.equal(videos.length, 2);
  assert.equal(videos.find((item) => item.title === "같은 영상")?.stage, "발행 키트");
});

test("goals and monthly reports share measured-only attainment", async () => {
  const [metrics, goals, reports] = await Promise.all([
    read("lib/home-dashboard.ts"),
    read("components/goals-workspace.tsx"),
    read("components/reports-workspace.tsx"),
  ]);
  assert.match(metrics, /export function attainmentPercent/);
  assert.match(metrics, /record\.metric_target === null/);
  assert.match(metrics, /record\.metric_current === null/);
  assert.match(metrics, /export function averageAttainment/);
  for (const source of [goals, reports]) assert.match(source, /averageAttainment/);
  assert.match(goals, /기준 미설정/);
  assert.match(goals, /측정 전/);
  assert.match(reports, /goalAttainment === null \? "측정 전"/);
});

test("monthly report uses a plain-language text download", async () => {
  const reports = await read("components/reports-workspace.tsx");
  assert.match(reports, /글 파일로 내려받기/);
  assert.match(reports, /text\/plain/);
  assert.match(reports, /\.txt`/);
  assert.doesNotMatch(reports, /MD 내려받기/);
});

test("home groups content lineage into one current-stage video row", async () => {
  const [metrics, dashboard] = await Promise.all([
    read("lib/home-dashboard.ts"),
    read("components/dashboard.tsx"),
  ]);
  assert.match(metrics, /export function groupHomeVideos/);
  assert.match(metrics, /contentRoot/);
  assert.match(metrics, /record\.parent_id/);
  assert.match(dashboard, /groupHomeVideos\(records\)/);
  assert.match(dashboard, /video-stage-badge/);
  assert.doesNotMatch(dashboard, /view\.videos\.map[\s\S]*item\.status[\s\S]*item\.due_date/);
});

test("home revenue uses performance records, targets and honest comparisons", async () => {
  const [metrics, dashboard] = await Promise.all([
    read("lib/home-dashboard.ts"),
    read("components/dashboard.tsx"),
  ]);
  assert.match(metrics, /record\.metadata\.net \?\? record\.amount/);
  assert.match(metrics, /monthChange: changePercent/);
  assert.match(metrics, /weekChange: changePercent/);
  assert.match(metrics, /targetByBrand/);
  assert.match(dashboard, /전월/);
  assert.match(dashboard, /전주/);
  assert.match(dashboard, /목표 설정하기/);
  assert.match(dashboard, /basisTime/);
  assert.match(dashboard, /statuses=canonical,reviewed,team/);
});

test("login entry wording remains Korean", async () => {
  const login = await read("app/login/page.tsx");
  assert.match(login, /팀 로그인/);
  assert.doesNotMatch(login, /TEAM SIGN IN/);
});
