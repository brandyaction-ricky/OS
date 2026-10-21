import assert from "node:assert/strict";
import test from "node:test";
import { confirmPlan, descChecks, draftMissing, emptyStage, hiddenTagsOf, lengthEstimate, outlineMissing, slotOf, thumbsMissing, withScriptVersion } from "../lib/youtube-process/stages.ts";
import { applyGateAction, editableFields } from "../lib/youtube-process/confirm.ts";
import { newProjectMeta } from "../lib/youtube-process/project.ts";

// 유튜브 공정 v1 step rules (지시서 4-4 ~ 4-8, 수용 기준 9).
test("기획안 needs titles A · B, thumbnails A · B and the 영상 흐름; the OK fixes the A · B · (C) pairs", () => {
  const plan = emptyStage("plan", "anim");
  assert.equal(draftMissing(plan), "제목 A(첫째 줄)를 써주세요");
  plan.titles[0].text = "A 제목"; plan.titles[1].text = "B 제목";
  assert.equal(draftMissing(plan), "썸네일 A(첫 번째 시안)를 넣어주세요");
  plan.thumbs[0] = { id: "a", mode: "text", copy: "큰 글자" }; plan.thumbs[1] = { id: "b", mode: "img", path: "youtube/x/plan_thumb/y.png" };
  assert.equal(draftMissing(plan), "오프닝을 써주세요");
  Object.assign(plan, { opening: "o", body: "b", closing: "c" });
  assert.equal(draftMissing(plan), "");
  const confirmed = confirmPlan(plan, "2026-10-21T00:00:00Z");
  assert.deepEqual(Object.keys(confirmed).sort(), ["A", "B", "at"]);
  assert.equal(confirmed.A.title, "A 제목");
  assert.equal(slotOf(3), "예비");
});

test("예상 길이: 3,150자 · 9분은 맞고 2,000자는 약 3분 짧다 (±20%, 분당 350자)", () => {
  assert.equal(lengthEstimate(`### 오프닝\n\n${"가".repeat(3150)}\n`, 9).verdict.ok, true);
  assert.deepEqual(lengthEstimate("가".repeat(2000), 9).verdict, { ok: false, text: "정한 러닝타임(9분)보다 약 3분 짧아요" });
  const outline = emptyStage("outline", "live");
  assert.equal(outlineMissing(outline), "러닝타임을 정해주세요");
  outline.spec.runtimeMin = 121;
  assert.equal(outlineMissing(outline), "러닝타임은 1 ~ 120분 사이 숫자로 써주세요");
  outline.spec.runtimeMin = 9; outline.script = "## 제목만\n";
  assert.equal(outlineMissing(outline), "원고를 써주세요");
  const versioned = withScriptVersion(withScriptVersion(outline, "하나", "리키", "t1", "manual"), "둘", "리키", "t2", "ai", "claude");
  assert.deepEqual(versioned.versions.map(item => [item.v, item.why]), [[1, "manual"], [2, "ai"]]);
  assert.equal(versioned.script, "둘");
});

test("제작 finishes with thumbnails A · B; 설명란 checks are advisory and the hidden tags feed YouTube tags", () => {
  const make = emptyStage("make", "anim");
  assert.equal(thumbsMissing(make), "최종 썸네일 A를 올려주세요");
  make.thumbs.A = { path: "p", at: "t", name: "a.png" }; make.thumbs.B = { path: "p", at: "t", name: "b.png" };
  assert.equal(thumbsMissing(make), "");
  const desc = "#강점 #성격\n-----\n⬇️ 내 강점 진단 받기\nhttps://www.brandyaction.com/classes/294620?utm_source=youtube\n-----\n[타임라인]\n00:00 시작\n01:10 둘째\n03:00 셋째\n-----\n[설명문 본문]\n1\n2\n3\n4\n5\n-----\n[인용 및 출처]\n- 수치 / 통계 / 기관 (2026, 2026-01)\n-----\n[히든 태그]\n강점, 성격";
  const checks = descChecks(desc, { srt: { path: "s", name: "s.srt" }, utm: { cat: "키", dest: "진단", camp: "jindan_report", next: "", short: "" } });
  assert.deepEqual(checks.map(check => check.ok), [true, true, true, true, true, true, true]);
  assert.deepEqual(hiddenTagsOf(desc), ["강점", "성격"]);
  assert.equal(descChecks(desc.replace("내 강점 진단 받기", "무료 진단 받기"), { srt: null, utm: { short: "", next: "" } })[4].ok, false);
});

test("기획안 수정 요청 opens only the ticked fields; 최종 검수 OK moves the project to 업로드", () => {
  const meta = newProjectMeta({ type: "anim", target: "t", note: "", refs: [] }, "2026-10-20T00:00:00Z");
  let project = { yp: { ...meta.yp, stage: "draft", gates: { ...meta.yp.gates, topic: { state: "ok", round: 1 } } } };
  project = { yp: applyGateAction(project, "draft", "request", { actor: "pd", now: "2026-10-21T01:00:00Z" }) };
  assert.deepEqual(editableFields(project, "draft"), []);
  project = { yp: applyGateAction(project, "draft", "changes", { actor: "ceo", now: "2026-10-21T02:00:00Z", fields: ["draft.tt"], memo: "제목을 짧게" }) };
  assert.deepEqual(editableFields(project, "draft"), ["draft.tt"]);
  assert.throws(() => applyGateAction(project, "draft", "changes", { actor: "ceo", now: "x", fields: ["topic.title"], memo: "m" }));
  let review = { yp: { ...project.yp, stage: "review" } };
  review = { yp: applyGateAction(review, "review", "request", { actor: "pd", now: "2026-10-21T03:00:00Z" }) };
  review = { yp: applyGateAction(review, "review", "ok", { actor: "ceo", now: "2026-10-21T04:00:00Z" }) };
  assert.equal(review.yp.stage, "upload");
});
