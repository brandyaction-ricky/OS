import assert from "node:assert/strict";
import test from "node:test";
import {
  newProjectMeta, parseYoutubeRef, projectFromRecord, projectHref, protectedYoutubeChange, recentProjects, searchProjects,
  similarProjects, stepHref, topicEditable, topicFieldEditable, topicLines, topicMissing, YP_MAX_LINES,
} from "../lib/youtube-process/project.ts";

const project = (id, title, stage = "topic", days = 0, gate = "none") => {
  const meta = newProjectMeta({ type: "live", target: "타겟", note: "", refs: [] }, new Date(Date.UTC(2026, 9, 15 - days)).toISOString());
  meta.yp.stage = stage;
  meta.yp.gates.topic = { state: gate, round: gate === "none" ? 0 : 1 };
  return { id, version: 1, title, assigneeId: null, ownerId: "u1", updatedAt: "", yp: meta.yp };
};

test("a multi-line topic splits into trimmed, non-empty lines", () => {
  assert.deepEqual(topicLines(" 첫째 주제 \n\n둘째 주제\r\n  셋째 주제  "), ["첫째 주제", "둘째 주제", "셋째 주제"]);
  assert.deepEqual(topicLines("   \n "), []);
});

test("topic confirm request names the first missing field (수용 3)", () => {
  assert.equal(topicMissing("", { type: "live", target: "타겟" }), "주제를 써 주세요");
  assert.equal(topicMissing("주제", { type: null, target: "타겟" }), "유형을 골라 주세요");
  assert.equal(topicMissing("주제", { type: "anim", target: "  " }), "정밀 타겟을 써 주세요");
  assert.equal(topicMissing("주제", { type: "anim", target: "타겟" }), "");
  assert.match(topicMissing(Array.from({ length: YP_MAX_LINES + 1 }, (_, i) => `주제 ${i}`).join("\n"), { type: "live", target: "타겟" }), /20줄까지/);
});

test("topic fields lock while waiting for the confirm and after it", () => {
  assert.equal(topicEditable(project("a", "x")), true);
  const changes = project("a", "x", "topic", 0, "changes");
  assert.equal(topicEditable(changes), false, "수정 요청 with no ticked field leaves nothing to edit");
  changes.yp.gates.topic.fields = ["topic.title"];
  assert.equal(topicEditable(changes), true);
  assert.equal(topicFieldEditable(changes, "title"), true);
  assert.equal(topicFieldEditable(changes, "target"), false);
  assert.equal(topicEditable(project("a", "x", "topic", 0, "wait")), false);
  assert.equal(topicEditable(project("a", "x", "draft", 0, "ok")), false);
});

test("projects list: six most recently edited, search by name", () => {
  const list = Array.from({ length: 8 }, (_, i) => project(`p${i}`, `주제 ${i}`, "topic", i));
  assert.deepEqual(recentProjects(list).map(row => row.id), ["p0", "p1", "p2", "p3", "p4", "p5"]);
  assert.deepEqual(searchProjects(list, "주제 7").map(row => row.id), ["p7"]);
  assert.equal(searchProjects(list, "  ").length, 8);
});

test("similar topics share words with the first line and skip the project itself", () => {
  const list = [project("a", "퇴근 후 부업 시작하기"), project("b", "강의 상세페이지 고치기"), project("self", "부업 세금 정리")];
  assert.deepEqual(similarProjects("부업 세금 정리하는 법\n다른 줄", list, "self").map(row => row.id), ["a"]);
  assert.deepEqual(similarProjects("전혀 다른 이야기", list), []);
  assert.deepEqual(similarProjects("[예시] 전혀 다른 이야기", [project("x", "[예시] 고객 인터뷰")]), [], "bracketed labels do not count");
});

test("only YouTube video links become references", () => {
  assert.deepEqual(parseYoutubeRef("https://youtu.be/dQw4w9WgXcQ?t=3"), { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", videoId: "dQw4w9WgXcQ" });
  assert.equal(parseYoutubeRef("https://m.youtube.com/shorts/dQw4w9WgXcQ")?.videoId, "dQw4w9WgXcQ");
  assert.equal(parseYoutubeRef("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x")?.videoId, "dQw4w9WgXcQ");
  assert.equal(parseYoutubeRef("https://example.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(parseYoutubeRef("javascript:alert(1)"), null);
  assert.equal(parseYoutubeRef("유튜브"), null);
});

test("records become projects only when they carry the v1 workflow", () => {
  const meta = newProjectMeta({ type: null, target: "", note: "", refs: [] }, "2026-10-15T00:00:00.000Z");
  const row = { id: "r1", version: 3, title: "주제", assignee_id: "u2", owner_id: "u1", updated_at: "x", metadata: { ...meta, origin: "own" } };
  assert.equal(projectFromRecord(row)?.assigneeId, "u2");
  assert.equal(projectFromRecord({ ...row, metadata: { origin: "own" } }), null);
});

test("the generic records API may not create or change v1 projects", () => {
  assert.equal(protectedYoutubeChange(null, { workflow: "youtube_v1" }), true);
  assert.equal(protectedYoutubeChange({ workflow: "youtube_v1" }, undefined), true);
  assert.equal(protectedYoutubeChange({ origin: "own" }, { origin: "own" }), false);
});

test("a project opens on its current step", () => {
  assert.equal(stepHref(1, "p 1"), "/content/plan?project=p%201&view=draft");
  assert.equal(projectHref(project("p", "x", "review")), "/content/final-check?project=p&tab=video");
  assert.equal(projectHref(project("p", "x", "done")), "/content/plan?project=p&view=topic");
  assert.equal(stepHref(6, "p"), "/content/shorts?project=p");
});
