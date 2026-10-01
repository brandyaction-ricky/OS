import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  attainmentPercent,
  averageAttainment,
  buildDailyBrief,
  buildDailyBriefWorkContext,
  buildHomeRevenueView,
  dailyBriefWorkDescription,
  groupHomeVideos,
} from "../lib/home-dashboard.ts";

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

test("daily brief ranks three tasks and keeps today's schedule in Seoul time", () => {
  const profileId = crypto.randomUUID();
  const blocked = record({ record_type: "task", title: "결제 막힘 해결", description: "담당자에게 오류 화면 전달", status: "blocked", priority: "high", assignee_id: profileId, due_date: "2026-10-03" });
  const overdue = record({ record_type: "task", title: "지난 업무", status: "planned", priority: "urgent", due_date: "2026-09-30" });
  const today = record({ record_type: "task", title: "오늘 업무", status: "active", due_date: "2026-10-01" });
  const later = record({ record_type: "task", title: "나중 업무", status: "planned", due_date: "2026-10-08" });
  const meeting = record({ record_type: "meeting", title: "오전 회의", status: "planned", starts_at: "2026-09-30T23:30:00.000Z" });
  const decisions = Array.from({ length: 3 }, (_, index) => record({ record_type: "decision", title: `결정 ${index}`, status: "open", updated_at: `2026-10-01T0${index}:00:00.000Z` }));
  const brief = buildDailyBrief([blocked, overdue, today, later, meeting, ...decisions], new Date("2026-10-01T00:30:00.000Z"), profileId);
  assert.equal(brief.date, "2026-10-01");
  assert.equal(brief.priorities.length, 3);
  assert.equal(brief.primary?.id, blocked.id);
  assert.equal(brief.firstAction, "담당자에게 오류 화면 전달");
  assert.equal(brief.delayed.some((item) => item.id === overdue.id), true);
  assert.equal(brief.schedule[0]?.id, meeting.id);
  assert.equal(brief.decisions.length, 2);
});

test("daily brief work context is related, bounded, and resumable", () => {
  const project = record({ record_type: "project", title: "신규 교육", brand: "에듀" });
  const task = record({ record_type: "task", title: "온보딩 작성", parent_id: project.id, brand: "에듀", team: "콘텐츠", tags: ["온보딩"] });
  const meetings = Array.from({ length: 5 }, (_, index) => record({ record_type: "meeting", title: `관련 회의 ${index}`, parent_id: project.id, brand: "에듀", updated_at: `2026-10-01T0${index}:00:00.000Z` }));
  const decision = record({ record_type: "decision", title: "범위 결정", metadata: { sourceTaskId: task.id } });
  const job = record({ record_type: "ai_job", title: "기존 작업", status: "active", metadata: { sourceTaskId: task.id } });
  const documents = Array.from({ length: 7 }, (_, index) => ({
    id: crypto.randomUUID(), title: `관련 문서 ${index}`, content_md: "", folder: "교육", status: "team", brand: "에듀", team: "콘텐츠", tags: ["온보딩"], source: "manual", source_ref: index === 0 ? task.id : null,
    owner_id: "", created_by: "", current_version: 1, created_at: "2026-09-01T00:00:00.000Z", updated_at: `2026-10-01T0${index}:00:00.000Z`,
  }));
  const context = buildDailyBriefWorkContext(task, [project, task, ...meetings, decision, job], documents);
  assert.equal(context.project?.id, project.id);
  assert.equal(context.meetings.length, 3);
  assert.equal(context.decisions[0]?.id, decision.id);
  assert.equal(context.documents.length, 5);
  assert.equal(context.activeJobs[0]?.id, job.id);
  const description = dailyBriefWorkDescription(task, context, "첫 문단을 작성한다");
  assert.match(description, /\[첫 행동\]\n첫 문단을 작성한다/);
  assert.match(description, /\[관련 지식\]/);
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
  assert.match(metrics, /monthChange: .*changePercent\(current, priorMonth\) : null/);
  assert.match(metrics, /weekChange: weekly\.currentRows \? changePercent\(weekly\.current, weekly\.previous\) : null/);
  assert.match(metrics, /targetByBrand/);
  assert.match(dashboard, /전월/);
  assert.match(dashboard, /전주/);
  assert.match(dashboard, /목표 설정하기/);
  assert.match(dashboard, /basisTime/);
  assert.match(dashboard, /statuses=canonical,reviewed,team/);
});

test("daily brief saves decisions, creates bounded AI jobs, and deep-links source records", async () => {
  const [dashboard, tasks, decisions, meetings, agents] = await Promise.all([
    read("components/dashboard.tsx"),
    read("components/tasks-workspace.tsx"),
    read("components/operations-workspace.tsx"),
    read("components/meeting-workspace.tsx"),
    read("components/organization-v3-workspaces.tsx"),
  ]);
  assert.match(dashboard, /buildDailyBrief\(records/);
  assert.match(dashboard, /status: "decided"/);
  assert.match(dashboard, /kind: "daily_brief_work"/);
  assert.match(dashboard, /contextScope/);
  assert.match(dashboard, /업무 시작/);
  assert.match(tasks, /searchParams\.get\("task"\)/);
  assert.match(decisions, /searchParams\.get\("record"\)/);
  assert.match(meetings, /searchParams\.get\("meeting"\)/);
  assert.match(agents, /searchParams\.get\("job"\)/);
  assert.match(agents, /전체 지식창고를 한꺼번에 불러오지 않습니다/);
});

test("login entry wording remains Korean", async () => {
  const login = await read("app/login/page.tsx");
  assert.match(login, /팀 로그인/);
  assert.doesNotMatch(login, /TEAM SIGN IN/);
});
