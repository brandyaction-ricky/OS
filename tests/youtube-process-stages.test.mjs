import assert from "node:assert/strict";
import test from "node:test";
import { confirmPlan, descChecks, diagnosisLink, linksMissing, publishAtProblem, withLinks, shortLinkProblem, utmBase, utmUrl, draftMissing, emptyStage, hiddenTagsOf, lengthEstimate, outlineMissing, slotOf, specOption, stageData, thumbFilled, thumbsMissing, withScriptVersion } from "../lib/youtube-process/stages.ts";
import { applyGateAction, editableFields } from "../lib/youtube-process/confirm.ts";
import { newProjectMeta } from "../lib/youtube-process/project.ts";

// 유튜브 공정 v1 step rules (지시서 4-4 ~ 4-8, 수용 기준 9).
test("기획안 needs titles A · B, thumbnails A · B and the 영상 흐름; the OK fixes the A · B · (C) pairs", () => {
  const plan = emptyStage("plan", "anim");
  assert.equal(draftMissing(plan), "첫째 줄 제목(A)을 써 주세요");
  plan.titles[0].text = "A 제목"; plan.titles[1].text = "B 제목";
  assert.equal(draftMissing(plan), "첫 번째 썸네일 후보(A)를 넣어 주세요");
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
  assert.deepEqual(lengthEstimate("가".repeat(2000), 9).verdict, { ok: false, text: "정한 러닝타임(9분)보다 약 3분 짧아요 · 내용이 필요하면 러닝타임을 고쳐요" });
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
  // 「유튜브 발행 키트 만드는 절차」 정본 v1.3 (2026-10-26): 소개로 시작, 타임라인 5~8줄, 요약 3줄 이내, 히든 태그 6~12개.
  const desc = "같은 일인데 왜 나만 지칠까요? 그 이유를 세 칸으로 나눠 봐요.\n-----\n#강점 #성격\n-----\n⬇️ 내 강점 진단 받기\nhttps://www.myinlab.co.kr/services/n6?utm_source=youtube\n-----\n[타임라인]\n00:00 시작\n01:10 둘째\n03:00 셋째\n05:00 넷째\n07:00 다섯째\n-----\n[설명문 본문]\n1\n2\n3\n-----\n[인용 및 출처]\n- 수치 / 통계 / 기관 (2026, 2026-01)\n-----\n[히든 태그]\n강점, 성격, 직장인, 이직, 퇴사, 일";
  const checks = descChecks(desc, { srt: { path: "s", name: "s.srt" }, utm: { cat: "키", dest: "진단", camp: "jindan_report", next: "", short: "" } });
  assert.deepEqual(checks.map(check => check.ok), [true, true, true, true, true, true, true, true]);
  assert.deepEqual(hiddenTagsOf(desc), ["강점", "성격", "직장인", "이직", "퇴사", "일"]);
  // Starting with the hashtags (the layout before v1.3), a 5-line body or 2 tags no longer pass.
  const old = descChecks(desc.replace("같은 일인데 왜 나만 지칠까요? 그 이유를 세 칸으로 나눠 봐요.\n-----\n", "").replace("3\n-----\n[인용", "3\n4\n5\n-----\n[인용").replace(", 직장인, 이직, 퇴사, 일", ""), { srt: null, utm: { short: "", next: "" } });
  assert.deepEqual([old[0].ok, old[3].ok, old[7].ok], [false, false, false]);
  assert.equal(descChecks(desc.replace("내 강점 진단 받기", "무료 진단 받기"), { srt: null, utm: { short: "", next: "" } })[4].ok, false);
  // 로건 요청 10/30: the 이어서 볼 영상 and 다른 유입처 go in under the 진단 링크, each once, and count as known links.
  const linkUtm = { cat: "키", dest: "진단", camp: "jindan_report", short: "", next: "https://youtu.be/abcdefghijk", nextNote: "다음 편 보기", others: [{ note: "PPT는 카페에서 받아 가세요", url: "https://cafe.naver.com/x/1" }, { note: "", url: "not a link" }] };
  assert.equal(linksMissing(desc, linkUtm).length, 2);
  const linked = withLinks(desc, linkUtm);
  assert.match(linked, /utm_source=youtube\n다음 편 보기\nhttps:\/\/youtu\.be\/abcdefghijk\nPPT는 카페에서 받아 가세요\nhttps:\/\/cafe\.naver\.com\/x\/1\n-----\n\[타임라인\]/);
  assert.equal(withLinks(linked, linkUtm), linked);
  assert.equal(descChecks(linked, { srt: null, utm: linkUtm })[5].ok, true);
  assert.match(withLinks("소개\n-----\n[히든 태그]\n강점", linkUtm), /https:\/\/cafe\.naver\.com\/x\/1\n-----\n\[히든 태그\]/);
  // 예약: a time already past, or closer than 10 minutes, is refused before anything is sent.
  assert.equal(publishAtProblem(null), "");
  assert.notEqual(publishAtProblem("2026-10-31T09:05:00.000Z", Date.parse("2026-10-31T09:00:00.000Z")), "");
  assert.equal(publishAtProblem("2026-10-31T10:00:00.000Z", Date.parse("2026-10-31T09:00:00.000Z")), "");
  // 정본 v1.4 (2026-10-31): 「미제공」「불확실」 never pass; a line with only what is known does.
  assert.equal(descChecks(desc.replace("(2026, 2026-01)", "(조사 시점 미제공) 불확실"), { srt: null, utm: { short: "", next: "" } })[6].ok, false);
  assert.equal(descChecks(desc.replace(" (2026, 2026-01)", ""), { srt: null, utm: { short: "", next: "" } })[6].ok, true);
  // 로건 피드백 10/26-10 · 11: a YouTube address under the 진단 CTA fails, also when it was pasted into the 단축 링크 field.
  const youtube = "https://youtu.be/abcdefghijk";
  const withYoutube = desc.replace("https://www.myinlab.co.kr/services/n6?utm_source=youtube", youtube);
  assert.equal(descChecks(withYoutube, { srt: null, utm: { short: youtube, next: youtube } })[5].ok, false);
  assert.equal(descChecks(desc.replace("https://www.myinlab.co.kr/services/n6?utm_source=youtube", "https://buly.kr/abc"), { srt: null, utm: { short: "https://buly.kr/abc", next: "" } })[5].ok, true);
  const utm = { cat: "키", dest: "진단", camp: "jindan_report", next: youtube, short: youtube };
  assert.match(diagnosisLink(utm), /^https:\/\/www\.myinlab\.co\.kr\/services\/n6\?/);
  // 보낼 곳 (owner decision 2026-10-26): any https address carries the video's UTM, also one with its own query.
  assert.equal(utmUrl({ ...utm, url: "https://www.myinlab.co.kr/services/free?ref=yt", camp: "jindan_report" }, "yp-1a2b3c4d"),
    "https://www.myinlab.co.kr/services/free?ref=yt&utm_source=youtube&utm_medium=organic&utm_campaign=jindan_report&utm_content=yp-1a2b3c4d");
  assert.equal(utmBase({ url: "javascript:alert(1)" }), "https://www.myinlab.co.kr/services/n6");
  assert.equal(diagnosisLink({ ...utm, short: "https://buly.kr/abc" }), "https://buly.kr/abc");
  assert.match(shortLinkProblem(youtube), /유튜브 주소/);
  assert.equal(shortLinkProblem("buly.kr/abc"), "");
});

test("기획안 수정 요청 opens every field; 최종 검토 OK moves the project to 업로드", () => {
  const meta = newProjectMeta({ type: "anim", target: "t", note: "", refs: [] }, "2026-10-20T00:00:00Z");
  let project = { yp: { ...meta.yp, stage: "draft", gates: { ...meta.yp.gates, topic: { state: "ok", round: 1 } } } };
  project = { yp: applyGateAction(project, "draft", "request", { actor: "pd", now: "2026-10-21T01:00:00Z" }) };
  project = { yp: applyGateAction(project, "draft", "changes", { actor: "ceo", now: "2026-10-21T02:00:00Z", fields: ["draft.tt"], memo: "제목을 짧게" }) };
  assert.equal(editableFields(project, "draft"), "all");
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
  assert.match(nextAction(project("draft", { draft: { state: "changes", round: 1, fields: ["draft.tt"] } })).text, /짚은 칸: 제목 · 썸네일/);
  assert.equal(nextAction(project("done")).tone, "done");
});

test("숏폼: 주제 → 대본 → 제작 → 최종 검토 → 내보내기; the 주제 OK opens 대본, the 대본 확정 opens 제작, and each step says what to do", async () => {
  const { flowOf, stageLabel } = await import("../lib/youtube-process/project.ts");
  const { nextAction } = await import("../lib/youtube-process/next.ts");
  const { gateName } = await import("../lib/youtube-process/confirm.ts");
  assert.deepEqual(flowOf("short").map(step => step.name), ["주제", "대본", "제작", "최종 검토", "내보내기"]);
  const meta = newProjectMeta({ type: "short", target: "t", note: "", refs: [] }, "2026-10-21T00:00:00Z");
  let project = { id: "p", yp: applyGateAction({ yp: meta.yp }, "topic", "request", { actor: "pd", now: "2026-10-21T01:00:00Z" }) };
  project = { ...project, yp: applyGateAction(project, "topic", "ok", { actor: "ceo", now: "2026-10-21T02:00:00Z" }) };
  assert.equal(project.yp.stage, "draft");
  assert.deepEqual([nextAction(project).button, nextAction(project).step, nextAction(project).total, stageLabel(project), gateName("draft", "short"), gateName("draft", "anim"), gateName("topic", "short"), gateName("topic", "anim")], ["대본 쓰기", 1, 5, "대본", "대본 확정", "기획안 컨펌", "주제 확정", "주제 컨펌"]);
  project = { ...project, yp: applyGateAction(project, "draft", "confirm", { actor: "pd", now: "2026-10-21T03:00:00Z" }) };
  assert.equal(project.yp.stage, "make");
  assert.deepEqual([nextAction(project).button, nextAction(project).step, nextAction(project).total, stageLabel(project)], ["숏폼 만들기", 2, 5, "제작"]);
  assert.equal(nextAction({ ...project, yp: { ...project.yp, stage: "upload" } }).button, "내보내기");
  assert.equal(nextAction({ id: "q", yp: { ...meta.yp, topic: { ...meta.yp.topic, type: "anim" }, stage: "make" } }).total, 7);
});

test("숏폼 scenes run on without gaps, the last one takes what is left, and what is missing is said in one line each", async () => {
  const { clipCuts, cutsFromScenes, scenesFromCuts, shortMissing } = await import("../lib/youtube-process/short.ts");
  const scene = (seconds, assetId) => ({ seconds, text: "자막", voice: "", note: "", asset: "", ...(assetId ? { assetId } : {}) });
  const cuts = cutsFromScenes([scene(4, "a"), scene(10), scene(99, "c")], 30);
  assert.deepEqual(cuts.map(cut => [cut.start, cut.end, cut.missingAsset]), [["00:00.000", "00:04.000", false], ["00:04.000", "00:14.000", true], ["00:14.000", "00:30.000", false]]);
  assert.deepEqual(scenesFromCuts(cuts).map(item => item.seconds), [4, 10, 16]);
  const diagram = {type:"lib_two_cards",scene:{left:{text:"전",t:0},right:{text:"후",t:1}}};
  const diagramCuts = cutsFromScenes([{...scene(0),diagram}],15);
  assert.equal(diagramCuts[0].missingAsset,false);
  assert.deepEqual(scenesFromCuts(diagramCuts)[0].diagram,diagram);
  const brief = { purpose: "ad", duration: 30, product: "결과지", audience: "직장인", goal: "진단", landingUrl: "", evidence: "", appeal: "" };
  assert.deepEqual(shortMissing(brief, scenesFromCuts(cuts)), ["연결할 페이지 주소를 써 주세요", "광고에 쓸 실제 근거를 써 주세요", "구매 이유를 하나 골라 주세요", "장면마다 이미지나 도식을 넣어 주세요"]);
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

// Usability QA 2026-10-25: [직접 쓰기] put the section layout in the box and the bare layout counted as a written description.
test("the bare description layout is not a description; any real line is", async () => {
  const { DESC_TEMPLATE, descWritten } = await import("../lib/youtube-process/stages.ts");
  assert.equal(descWritten(""), false);
  assert.equal(descWritten(DESC_TEMPLATE), false);
  assert.equal(descWritten(DESC_TEMPLATE.replace("[설명문 본문]\n", "[설명문 본문]\n퇴근 후 2시간을 나누는 법\n")), true);
  assert.equal(descWritten("#강점 #성격"), true);
});

// 로건 다시 요청 10/30: one 「(기본)」 in the 프레임 list; an older 「30fps (기본)」 shows as 「30fps」; a new 애니 opens at 60fps.
test("spec values saved under an older label show as today's option", () => {
  assert.equal(specOption("anim", "fps", "30fps (기본)"), "30fps");
  assert.equal(specOption("anim", "fps", "60fps (기본)"), "60fps (기본)");
  assert.equal(specOption("anim", "res", "4K (선명 · 기본)"), "4K (선명)");
  assert.equal(specOption("live", "fps", "60fps"), "60fps");
  assert.equal(specOption("anim", "fps", "12fps"), "12fps");
  assert.equal(stageData("outline", undefined, "anim").spec.fps, "60fps (기본)");
});

// 로건 QA 10/30: looking at the 「이미지」 tab of a written card must not empty it.
test("a thumbnail card is filled by its words or its image", () => {
  assert.equal(thumbFilled({ mode: "img", copy: "퇴근 후 3분", screen: "" }), true);
  assert.equal(thumbFilled({ mode: "img", copy: "", screen: "", path: "a.png" }), true);
  assert.equal(thumbFilled({ mode: "text", copy: " ", screen: "" }), false);
  assert.equal(thumbFilled(null), false);
});
