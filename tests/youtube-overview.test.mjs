import assert from "node:assert/strict";
import test from "node:test";
import { decisionsToday, overviewCounts, overviewRows } from "../lib/youtube-process/overview.ts";
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
