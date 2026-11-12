import assert from "node:assert/strict";
import test from "node:test";
import { changedRows, channelDay, channelNext, decisionsToday, mapBranches, overviewCounts, overviewRows } from "../lib/youtube-process/overview.ts";
import { newProjectMeta } from "../lib/youtube-process/project.ts";

const NOW = Date.parse("2026-10-31T03:00:00Z");
const ago = minutes => new Date(NOW - minutes * 60_000).toISOString();
function project(id, kind, stage, extra = {}) {
  const { yp } = newProjectMeta({ type: kind, target: "직장인", note: "", refs: [], ...(extra.purpose ? { purpose: extra.purpose } : {}) }, ago(600));
  yp.stage = stage;
  Object.assign(yp.gates, extra.gates ?? {});
  return { id, version: 1, title: `영상 ${id}`, assigneeId: extra.assigneeId ?? "pd", ownerId: "pd", updatedAt: ago(60), yp };
}
const waiting = gate => ({ [gate]: { state: "wait", round: 1, requestedAt: ago(130) } });

// 한눈에 보기 (리키 관제실 시안 P1, 2026-10-31): one list of open work, grouped by what it needs now.
test("a waiting step is my decision only as the approver or the video's PD; a blocked AI job comes first", () => {
  const projects = [
    project("a", "live", "topic", { gates: waiting("topic") }),
    project("b", "live", "outline"),
    project("c", "short", "make", { purpose: "ad" }),
    project("d", "card", "review", { gates: waiting("review"), assigneeId: "me" }),
    project("e", "anim", "draft", { gates: { draft: { state: "hold", round: 1, reason: "다음 달로" } } }),
    project("f", "live", "done"),
  ];
  const jobs = [
    { sourceId: "b", task: "원고", status: "active", requestedAt: ago(9), claimedAt: ago(4), failReason: null },
    { sourceId: "c", task: "숏폼 장면", status: "blocked", requestedAt: ago(50), claimedAt: ago(48), failReason: "주소를 열지 못했어요" },
  ];
  const staff = overviewRows(projects, jobs, { id: "me", canConfirm: false }, NOW);
  assert.equal(staff.done, 1);
  assert.deepEqual(staff.rows.map(row => [row.id, row.state]), [["d", "decide"], ["b", "ai"], ["c", "blocked"], ["a", "wait"], ["e", "wait"]]);
  assert.equal(staff.rows.find(row => row.id === "b").now, "원고 · 4분째");
  assert.equal(staff.rows.find(row => row.id === "c").channel, "ad");
  assert.equal(staff.rows.find(row => row.id === "a").now, "주제 컨펌 대기 · 2시간째");
  assert.equal(staff.rows.find(row => row.id === "d").stage, "3/4 · 최종 검토");
  const approver = overviewRows(projects, jobs, { id: "boss", canConfirm: true }, NOW);
  assert.deepEqual(approver.rows.filter(row => row.state === "decide").map(row => row.id), ["a", "d"]);
  assert.deepEqual(overviewCounts(approver.rows), { decide: 2, ai: 1, by: { longform: { decide: 1, ai: 1 }, card: { decide: 1, ai: 0 } } });
});

test("people's steps say what comes next, and a 수정 요청 shows the 대표's words", () => {
  const fix = project("g", "live", "draft", { gates: { draft: { state: "changes", round: 1, fields: [], memo: "제목을 짧게" } } });
  const rows = overviewRows([project("h", "live", "make"), fix], [], { id: "me", canConfirm: false }, NOW).rows;
  assert.equal(rows.find(row => row.id === "h").now, "다음: 영상 만들기");
  assert.match(rows.find(row => row.id === "g").now, /대표 수정 요청 · 제목을 짧게/);
  assert.ok(rows.every(row => row.state === "human"));
});

test("Threads posts join the list by status, and published ones only count as done", () => {
  const { rows, done } = overviewRows([], [], { id: "me", canConfirm: false }, NOW, [
    { id: "t1", title: "글 하나", status: "review", updatedAt: ago(20) },
    { id: "t2", title: "", status: "draft", updatedAt: ago(10) },
    { id: "t3", title: "올린 글", status: "published", updatedAt: ago(5) },
  ]);
  assert.equal(done, 1);
  assert.deepEqual(rows.map(row => [row.id, row.state, row.href]), [["t1", "decide", "/automation/review"], ["t2", "human", "/automation/threads"]]);
  assert.equal(rows[1].title, "제목 없는 글");
});

test("오늘 내린 결정 lists today's decisions (Korean day), newest first", () => {
  const today = project("i", "live", "draft", { gates: { topic: { state: "ok", round: 1, decidedAt: ago(30), self: true } } });
  const yesterday = project("j", "live", "draft", { gates: { topic: { state: "ok", round: 1, decidedAt: ago(60 * 20) } } });
  const held = project("k", "short", "topic", { gates: { topic: { state: "hold", round: 1, decidedAt: ago(10), reason: "보류" } } });
  assert.deepEqual(decisionsToday([today, yesterday, held], NOW).map(item => item.what), ["주제 확정 → 보류", "주제 컨펌 → 컨펌 (PD)"]);
});

// 시안 P2 결론 먼저: a result that came with a report waits on whoever sent the job or the PD, until taken or moved past.
test("an AI result with a report is the sender's or PD's decision and drops out once the video moves on", () => {
  const report = { conclusion: "제목 후보 3개, A가 공식에 가장 가까워요", did: ["참고 영상 12개 읽음"], evidence: ["패키징 정본"] };
  const arrived = (sourceId, ownerId, doneAt = ago(30)) => ({ id: `job-${sourceId}`, ownerId, sourceId, task: "기획안", status: "done", requestedAt: ago(60), claimedAt: ago(50), failReason: null, doneAt, report });
  const projects = [
    project("p", "live", "outline", { assigneeId: "pd" }),
    project("q", "live", "outline", { assigneeId: "pd", gates: { topic: { state: "ok", round: 1, decidedAt: ago(10) } } }),
    project("r", "live", "outline", { assigneeId: "pd" }),
  ];
  const jobs = [arrived("p", "me"), arrived("q", "me"), arrived("r", "other"), { sourceId: "r", task: "원고", status: "active", requestedAt: ago(5), claimedAt: ago(3), failReason: null }];
  const mine = overviewRows(projects, jobs, { id: "me", canConfirm: true }, NOW).rows;
  // q's topic was decided after the result came, so it is old news; r's newer open job wins over its older result.
  assert.deepEqual(mine.map(row => [row.id, row.state]), [["p", "decide"], ["r", "ai"], ["q", "human"]]);
  assert.equal(mine[0].now, "AI 결과 도착 · 기획안");
  assert.equal(mine[0].job.report.conclusion, report.conclusion);
  const someone = overviewRows([projects[0]], [arrived("p", "other")], { id: "boss", canConfirm: true }, NOW).rows;
  assert.deepEqual(someone.map(row => [row.state, row.now]), [["human", "AI 결과 도착 · 기획안 · 담당자 확인 중"]]);
  assert.equal(overviewRows([projects[0]], [arrived("p", "other")], { id: "pd", canConfirm: false }, NOW).rows[0].state, "decide");
});

// 시안 P3 지도 보기 · 채널 확대 · 지켜보기
test("어제 is the same list for the Korean day before, and each decision knows its channel", () => {
  const today = project("i", "live", "draft", { gates: { topic: { state: "ok", round: 1, decidedAt: ago(30) } } });
  const yesterday = project("j", "card", "draft", { gates: { topic: { state: "changes", round: 1, decidedAt: ago(60 * 20) } } });
  assert.deepEqual(decisionsToday([today, yesterday], NOW, 1).map(item => [item.title, item.channel]), [["영상 j", "card"]]);
  assert.equal(decisionsToday([today, yesterday], NOW)[0].channel, "longform");
});

test("the map keeps the 새 일 order and changed rows ignore the ticking minutes", () => {
  const projects = [project("a", "live", "outline"), project("c", "card", "outline")];
  const job = { sourceId: "a", task: "원고", status: "active", requestedAt: ago(9), claimedAt: ago(4), failReason: null };
  const first = overviewRows(projects, [job], { id: "me", canConfirm: false }, NOW).rows;
  assert.deepEqual(mapBranches(first).map(branch => [branch.channel, branch.rows.map(row => row.id)]),
    [["longform", ["a"]], ["short", []], ["ad", []], ["card", ["c"]], ["threads", []]]);
  // ten minutes later nothing changed but the clock
  const later = overviewRows(projects, [job], { id: "me", canConfirm: false }, NOW + 600_000).rows;
  assert.deepEqual(changedRows(first, later), []);
  // the job's result arrives: that leaf lights up
  const arrived = overviewRows(projects, [{ ...job, status: "done", doneAt: ago(1), ownerId: "me" }], { id: "me", canConfirm: false }, NOW).rows;
  assert.deepEqual(changedRows(first, arrived), ["a"]);
});

test("채널 확대 lists that channel's day — decisions and AI job moments — and what comes next", () => {
  const projects = [project("a", "live", "outline", { gates: { topic: { state: "ok", round: 1, decidedAt: ago(90) } } }), project("c", "card", "outline")];
  const job = { sourceId: "a", task: "원고", status: "active", requestedAt: ago(40), claimedAt: ago(20), failReason: null };
  const { rows } = overviewRows(projects, [job], { id: "me", canConfirm: false }, NOW);
  const today = channelDay(rows, decisionsToday(projects, NOW), "longform", NOW);
  assert.deepEqual(today.map(item => item.what), ["원고 · AI가 가져감", "원고 · 맡김", "주제 컨펌 → 컨펌"]);
  assert.deepEqual(channelDay(rows, decisionsToday(projects, NOW, 1), "longform", NOW, 1), []);
  assert.deepEqual(channelNext(rows, "card").map(row => row.id), ["c"]);
});


test("unclaimed AI jobs are queued, not running; blocked summaries hide internal errors", () => {
  const projects = [project("queue", "live", "outline"), project("failure", "live", "outline")];
  const { rows } = overviewRows(projects, [
    {sourceId:"queue",task:"원고",status:"backlog",requestedAt:ago(60),claimedAt:null,failReason:null},
    {sourceId:"failure",task:"원고",status:"blocked",requestedAt:ago(30),claimedAt:null,failReason:"/private/internal/file token=secret"},
  ], {id:"me",canConfirm:false}, NOW);
  assert.equal(rows.find(row => row.id === "queue").state, "queued");
  assert.equal(overviewCounts(rows).ai, 0);
  assert.doesNotMatch(rows.find(row => row.id === "failure").now, /private|secret/);
});
