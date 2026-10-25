import assert from "node:assert/strict";
import test from "node:test";
import { confirmPlan, descChecks, draftMissing, emptyStage, hiddenTagsOf, lengthEstimate, outlineMissing, slotOf, thumbsMissing, withScriptVersion } from "../lib/youtube-process/stages.ts";
import { applyGateAction, editableFields } from "../lib/youtube-process/confirm.ts";
import { newProjectMeta } from "../lib/youtube-process/project.ts";

// 유튜브 공정 v1 step rules (지시서 4-4 ~ 4-8, 수용 기준 9).
test("기획안 needs titles A · B, thumbnails A · B and the 영상 흐름; the OK fixes the A · B · (C) pairs", () => {
  const plan = emptyStage("plan", "anim");
  assert.equal(draftMissing(plan), "첫째 줄 제목(A)을 써 주세요");
  plan.titles[0].text = "A 제목"; plan.titles[1].text = "B 제목";
  assert.equal(draftMissing(plan), "첫 번째 썸네일 시안(A)을 넣어 주세요");
  plan.thumbs[0] = { id: "a", mode: "text", copy: "큰 글자" }; plan.thumbs[1] = { id: "b", mode: "img", path: "youtube/x/plan_thumb/y.png" };
  assert.equal(draftMissing(plan), "오프닝을 써 주세요");
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
  assert.equal(outlineMissing(outline), "러닝타임을 정해 주세요");
  outline.spec.runtimeMin = 121;
  assert.equal(outlineMissing(outline), "러닝타임은 1 ~ 120분 사이 숫자로 써 주세요");
  outline.spec.runtimeMin = 9; outline.script = "## 제목만\n";
  assert.equal(outlineMissing(outline), "원고를 써 주세요");
  const versioned = withScriptVersion(withScriptVersion(outline, "하나", "리키", "t1", "manual"), "둘", "리키", "t2", "ai", "claude");
  assert.deepEqual(versioned.versions.map(item => [item.v, item.why]), [[1, "manual"], [2, "ai"]]);
  assert.equal(versioned.script, "둘");
});

test("제작 finishes with thumbnails A · B; 설명란 checks are advisory and the hidden tags feed YouTube tags", () => {
  const make = emptyStage("make", "anim");
  assert.equal(thumbsMissing(make), "A 최종 썸네일을 올려 주세요");
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

test("내 영상 says what each video needs next in one sentence and one button", async () => {
  const { nextAction } = await import("../lib/youtube-process/next.ts");
  const meta = newProjectMeta({ type: "anim", target: "t", note: "", refs: [] }, "2026-10-21T00:00:00Z");
  const project = (stage, gates = {}) => ({ id: "p", yp: { ...meta.yp, stage, gates: { ...meta.yp.gates, ...gates } } });
  assert.deepEqual([nextAction(project("outline")).tone, nextAction(project("outline")).button], ["todo", "원고 쓰기"]);
  assert.equal(nextAction(project("draft", { draft: { state: "wait", round: 1 } })).tone, "wait");
  assert.match(nextAction(project("draft", { draft: { state: "changes", round: 1, fields: ["draft.tt"] } })).text, /고칠 칸: 제목 · 썸네일/);
  assert.equal(nextAction(project("done")).tone, "done");
});

test("숏폼: 주제 → 제작 → 최종 검수 → 내보내기; the 주제 OK opens 제작 and each step says what to do", async () => {
  const { flowOf, stageLabel } = await import("../lib/youtube-process/project.ts");
  const { nextAction } = await import("../lib/youtube-process/next.ts");
  assert.deepEqual(flowOf("short").map(step => step.name), ["주제", "제작", "최종 검수", "내보내기"]);
  const meta = newProjectMeta({ type: "short", target: "t", note: "", refs: [] }, "2026-10-21T00:00:00Z");
  let project = { id: "p", yp: applyGateAction({ yp: meta.yp }, "topic", "request", { actor: "pd", now: "2026-10-21T01:00:00Z" }) };
  project = { ...project, yp: applyGateAction(project, "topic", "ok", { actor: "ceo", now: "2026-10-21T02:00:00Z" }) };
  assert.equal(project.yp.stage, "make");
  assert.deepEqual([nextAction(project).button, nextAction(project).step, nextAction(project).total, stageLabel(project)], ["숏폼 만들기", 1, 4, "제작"]);
  assert.equal(nextAction({ ...project, yp: { ...project.yp, stage: "upload" } }).button, "내보내기");
  assert.equal(nextAction({ id: "q", yp: { ...meta.yp, topic: { ...meta.yp.topic, type: "anim" }, stage: "make" } }).total, 7);
});

test("숏폼 scenes run on without gaps, the last one takes what is left, and what is missing is said in one line each", async () => {
  const { clipCuts, cutsFromScenes, scenesFromCuts, shortMissing } = await import("../lib/youtube-process/short.ts");
  const scene = (seconds, assetId) => ({ seconds, text: "자막", voice: "", note: "", asset: "", ...(assetId ? { assetId } : {}) });
  const cuts = cutsFromScenes([scene(4, "a"), scene(10), scene(99, "c")], 30);
  assert.deepEqual(cuts.map(cut => [cut.start, cut.end, cut.missingAsset]), [["00:00.000", "00:04.000", false], ["00:04.000", "00:14.000", true], ["00:14.000", "00:30.000", false]]);
  assert.deepEqual(scenesFromCuts(cuts).map(item => item.seconds), [4, 10, 16]);
  const brief = { purpose: "ad", duration: 30, product: "결과지", audience: "직장인", goal: "진단", landingUrl: "", evidence: "", appeal: "" };
  assert.deepEqual(shortMissing(brief, scenesFromCuts(cuts)), ["연결할 페이지 주소를 써주세요", "광고에 쓸 실제 근거를 써주세요", "구매 이유를 하나 골라주세요", "장면마다 이미지를 넣어주세요"]);
  assert.deepEqual(shortMissing({ ...brief, duration: 15 }, [scene(10, "a"), scene(6, "b"), scene(0, "c")]).at(-1), "앞 장면들이 15초를 넘어요");
  // A longform clip: one cut per subtitle line in source time, joined end to start; lines starting within 0.3s share one caption.
  const cues = [{ start: 9, end: 12, text: "앞" }, { start: 12, end: 14, text: "하나" }, { start: 12.2, end: 16, text: "둘" }, { start: 17, end: 30, text: "셋" }];
  assert.deepEqual(clipCuts(cues, 10, 20, "제목").map(cut => [cut.start, cut.end, cut.text]), [["00:10.000", "00:12.000", "앞"], ["00:12.000", "00:17.000", "하나 둘"], ["00:17.000", "00:20.000", "셋"]]);
  assert.deepEqual(clipCuts([], 5, 20, "제목").map(cut => [cut.start, cut.end, cut.text]), [["00:05.000", "00:20.000", "제목"]]);
  const many = Array.from({ length: 30 }, (_, i) => ({ start: i * 2, end: i * 2 + 2, text: `${i}` }));
  const merged = clipCuts(many, 0, 60, "제목");
  assert.equal(merged.length, 15);
  assert.equal(merged.at(-1).end, "01:00.000");
});

test("v1 rolls out per person: off, everyone, or only the listed ids (the ids never reach the browser)", async () => {
  const { youtubeV1AllowedFor, youtubeV1Mode } = await import("../lib/youtube-process/gate.ts");
  assert.equal(youtubeV1Mode({}), "off");
  assert.equal(youtubeV1Mode({ YOUTUBE_V1_ENABLED: "true" }), "all");
  const some = { YOUTUBE_V1_ENABLED: "true", YOUTUBE_V1_USERS: " a , b " };
  assert.equal(youtubeV1Mode(some), "some");
  assert.deepEqual([youtubeV1AllowedFor("a", some), youtubeV1AllowedFor("c", some), youtubeV1AllowedFor("c", { YOUTUBE_V1_ENABLED: "true" }), youtubeV1AllowedFor("a", { YOUTUBE_V1_USERS: "a" })], [true, false, true, false]);
});
