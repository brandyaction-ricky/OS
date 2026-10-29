import assert from "node:assert/strict";
import test from "node:test";
import { checkShortScript, headCopyProblem, parseCount, refCounts, refCountsLine, refHostOk, refMatchesQuery, refPlatform, refReaction, refTexts, scriptLines, shortResearchOpen, shortScriptMissing, shortTopicPickProblems } from "../lib/youtube-process/short-script.ts";
import { emptyGates } from "../lib/youtube-process/project.ts";

// 숏폼 대본 정본 §10 기계 검사 (owner direction 2026-10-28): the OS counts these when the staff AI submits and before the PD's 대본 확정.
const good = `퇴근하고 소파에 누워 휴대폰만 봐요
할 일은 두 개뿐이었는데 말이죠
[사람] 3년 차 마케터 지은 씨도 그랬어요
지은 씨는 하루 종일 바쁘지 않았어요
그런데 저녁만 되면 힘이 하나도 없어요
다들 체력 문제라고 생각하죠
근데 진짜 이유는 따로 있었어요
[관계] 일한 시간보다 고른 횟수가 문제였어요
메일 하나 열 때마다 뭘 먼저 할지 정했거든요
작은 결정이 하루에 백 번 넘게 쌓였어요
그래서 몸보다 머리가 먼저 지친 거예요
지은 씨는 아침에 순서를 한 번만 정했어요
그날 저녁엔 산책 나갈 힘이 남았대요
지친 건 일이 많아서가 아니었어요
오늘 몇 번 고르셨어요?`;

test("a 30~45초 대본 passes; the [관계] · [사람] marks are screen hints, not spoken", () => {
  const check = checkShortScript(good);
  assert.deepEqual(check.problems, []);
  assert.deepEqual([check.lines, check.chars >= 250 && check.chars <= 370, check.seconds >= 30 && check.seconds <= 45], [15, true, true]);
  assert.deepEqual(scriptLines(good)[2], { text: "3년 차 마케터 지은 씨도 그랬어요", mark: "사람" });
  assert.deepEqual(checkShortScript("").problems, ["대본을 써 주세요"]);
});

test("length, the first line, long lines and the banned words are counted", () => {
  const lines = good.split("\n");
  assert.match(checkShortScript(lines.slice(0, 6).join("\n")).problems[0], /250자 이상/);
  assert.match(checkShortScript([...lines, ...lines.slice(1, 6)].join("\n")).notes[0], /60초 쇼츠로만/);
  assert.match(checkShortScript([...lines, ...lines, ...lines].join("\n")).problems[0], /490자/);
  assert.ok(checkShortScript(["퇴근하고 집에 오면 소파에 누워 휴대폰만 계속 봐요", ...lines.slice(1)].join("\n")).problems.some(problem => /첫 문장이 2\d자/.test(problem)));
  assert.ok(checkShortScript([...lines.slice(0, 5), "메일 하나 열 때마다 뭘 먼저 할지 매번 새로 정했거든요 그래서요", ...lines.slice(6)].join("\n")).problems.some(problem => /6번째 줄이 3\d자/.test(problem)));
  const banned = checkShortScript([...lines.slice(0, 14), "여러분은 앞에서 말한 것처럼 몇 번 고르셨어요?"].join("\n")).problems;
  assert.ok(banned.some(problem => problem.startsWith("부르는 말 「여러분」")) && banned.some(problem => problem.startsWith("바깥을 가리키는 말 「앞에서」")));
});

test("10 letters the same as a 레퍼런스 or the 정본 is copying; a shorter match is not", () => {
  const ref = "회사 그만두기 전에 이것부터 하세요\n작은 결정이 하루에 백 번 넘게 쌓였어요";
  assert.match(checkShortScript(good, { refs: [ref] }).problems[0], /참고 영상과 같은 구간 「작은 결정이 하루에 백 번 넘게 쌓였어요」 \(10번째 줄\)/);
  assert.deepEqual(checkShortScript(good, { refs: ["작은 결정이 하루"] }).problems, []);
  assert.match(checkShortScript(good, { canon: "그래서 몸보다 머리가 먼저 지친" }).problems[0], /정본과 같은 구간/);
});

test("대본 확정 needs the 통찰 한 줄, a 헤드 카피 and a script that passes, with the PD's and the fetched references counted", () => {
  const script = { query: "", refs: [], text: good, hooks: [], insight: "", formula: "", headCopy: "" };
  assert.equal(shortScriptMissing(script), "통찰 한 줄을 써 주세요");
  assert.equal(shortScriptMissing({ ...script, insight: "지치는 건 결정 횟수 때문" }), "첫 화면 헤드 카피를 써 주세요");
  assert.match(headCopyProblem("저녁마다 지치는 진짜 이유는 일이 아니었어요"), /20자 이하/);
  assert.equal(shortScriptMissing({ ...script, insight: "지치는 건 결정 횟수 때문", headCopy: "일은 두 개뿐인데 왜 지칠까" }), "");
  const fetched = { items: [{ title: "퇴사 고민", result: { transcript: "0.0 그래서 몸보다 머리가 먼저 지친 거예요\n2.1 다음 줄" } }] };
  assert.match(shortScriptMissing({ ...script, insight: "x", headCopy: "헤드" }, fetched), /참고 영상과 같은 구간/);
  assert.ok(refTexts(script, fetched)[0].includes("그래서 몸보다") && !refTexts(script, fetched)[0].includes("0.0"));
  assert.match(shortScriptMissing({ ...script, insight: "x", headCopy: "헤드", refs: [{ url: "https://youtu.be/x", title: "", script: "다들 체력 문제라고 생각하죠 그게 아니에요" }] }), /참고 영상과 같은 구간/);
});

test("the render PC is handed YouTube, Instagram, TikTok and Meta ad links only", () => {
  for (const ok of ["https://www.youtube.com/shorts/abc", "https://youtu.be/abc", "https://www.instagram.com/reel/abc/", "https://www.facebook.com/ads/library/?id=1", "https://vt.tiktok.com/x"]) assert.equal(refHostOk(ok), true, ok);
  for (const bad of ["http://youtube.com/x", "https://evil.com/youtube.com", "https://youtube.com.evil.com/x", "file:///etc/passwd", "-o /tmp/x"]) assert.equal(refHostOk(bad), false, bad);
});

// 숏폼 주제 (owner direction 2026-10-28): a 초안 주제 → 참고 영상 → 공식 → 주제 후보 셋 → 주제 확정, so references and formulas open on 주제.
test("참고 영상 · 공식 are worked on from 주제 until the 대본 is confirmed, on a 숏폼 only", () => {
  const project = (stage, type = "short") => ({ yp: { stage, topic: { type }, gates: emptyGates() } });
  assert.deepEqual(["topic", "draft", "make"].map(stage => shortResearchOpen(project(stage))), [true, true, false]);
  assert.equal(shortResearchOpen(project("topic", "anim")), false);
});

test("three 주제 후보, one line each, on a formula drawn now or kept in the 공식 창고", () => {
  const topic = (title, formula = "숫자 반전") => ({ title, insight: "통찰", formula, why: "" });
  assert.deepEqual(shortTopicPickProblems([topic("하나"), topic("둘"), topic("셋", "창고 공식")], ["숫자 반전", "창고 공식"]), []);
  assert.match(shortTopicPickProblems([topic("하나"), topic("둘")], ["숫자 반전"]).join(" "), /3개예요 — 지금 2개/);
  assert.match(shortTopicPickProblems([topic("하나"), topic("둘"), topic("셋", "없는 공식")], ["숫자 반전"]).join(" "), /「없는 공식」가 formulas에도 창고에도 없어요/);
  assert.match(shortTopicPickProblems([topic("하나"), topic("하나"), topic("가".repeat(41))], ["숫자 반전"]).join(" "), /한 줄 40자 이하.*같아요/);
});

// 반응도 기준 (owner 2026-10-28: "반응도가 높은 콘텐츠 레퍼런스만 취합"): 조회 10만+, 구독자 수보다 많이, 좋아요 2%+.
test("a reference passes the 반응도 기준 only over all it shows; a known low count is below, too little shown is unknown", () => {
  assert.equal(refReaction({ views: 1_250_000, followers: 92_000, likes: 41_000 }), "pass");
  // 2026-10-28 sample of Korean 이직 · 퇴사 Shorts: 「퇴사 시그널」 154만 · 1.0% · 5.6배 passes, 「신박한 연봉협상」 0.4% does not.
  assert.equal(refReaction({ views: 1_538_769, followers: 274_000, likes: 15_400 }), "pass");
  assert.equal(refReaction({ views: 845_371, followers: 76_000, likes: 3_400 }), "below");
  assert.equal(refReaction({ views: 30_000, followers: 1_000, likes: 3_000 }), "below");
  assert.equal(refReaction({ views: 500_000, followers: 900_000, likes: 20_000 }), "below");
  // No follower count (TikTok, a hidden YouTube count): views and likes decide; hidden likes: views and followers decide.
  assert.equal(refReaction({ views: 500_000, followers: null, likes: 20_000 }), "pass");
  assert.equal(refReaction({ views: 4_122_579, followers: 97_000, likes: null }), "pass");
  assert.equal(refReaction({ views: 500_000, followers: null, likes: null }), "unknown");
  assert.equal(refReaction({ views: null, followers: null, likes: null }), "unknown");
  assert.equal(refReaction({ views: 32_000, followers: null, likes: null }), "below");
  // The YouTube search's counts come first, then what the render PC read off the page.
  const pd = { views: null, followers: null, likes: null, result: { views: 300_000, likes: 9_000, followers: 50_000 } };
  assert.deepEqual(refCounts(pd), { views: 300_000, followers: 50_000, likes: 9_000 });
  assert.equal(refCountsLine(refCounts(pd)), "조회 30만 · 구독자의 6배 · 좋아요 3%");
  assert.equal(refCountsLine({ views: 1_250_000, followers: null, likes: null }), "조회 125만");
});

test("Reels · TikTok counts as pages show them, and where each reference is from", () => {
  assert.deepEqual(["12.5만", "3,400", "1.2M", "7천", "980", "", "많음"].map(parseCount), [125_000, 3_400, 1_200_000, 7_000, 980, null, null]);
  // As people type them off a page (2026-10-28 review): units after the number, groups, 천 inside 만.
  assert.deepEqual(["12만회", "10,000회", "1천만", "12만5천", "3억2천만", "1만2345", "2.3K", "12만 명"].map(parseCount), [120_000, 10_000, 10_000_000, 125_000, 320_000_000, 12_345, 2_300, 120_000]);
  assert.deepEqual(["https://www.tiktok.com/@a/video/1", "https://www.instagram.com/reel/x/", "https://www.facebook.com/ads/library/?id=1", "https://youtu.be/a", "https://www.youtube.com/shorts/a"].map(refPlatform),
    ["틱톡", "릴스", "메타 광고", "유튜브", "유튜브"]);
});

test("a found Short counts only when its title shares a two-letter word run with the 검색어", () => {
  // 시안 2 (2026-10-28): 「일이 안 맞는 신호」 brought two viral Shorts about something else.
  assert.equal(refMatchesQuery("일이 안 맞는 신호", "오줌이 마려울 땐 이 포즈를 따라해보세요✨#shorts"), false);
  assert.equal(refMatchesQuery("일이 안 맞는 신호", "사연) 신입 멘탈 미쳤네.. 존경스럽다.."), false);
  assert.equal(refMatchesQuery("일이 안 맞는 신호", "회사랑 안 맞는 사람 특징 #shorts"), true);
  assert.equal(refMatchesQuery("일이 안 맞는 신호", "퇴사해야 한다는 신호 3가지"), true);
  assert.equal(refMatchesQuery("Career change", "My CAREER pivot"), true);
  assert.equal(refMatchesQuery("일 돈", "아무 제목"), true);
  // Latin and number words count whole: 「#shorts」 and 「2030」 are not 「MBTI」 or 「30대」.
  assert.equal(refMatchesQuery("MBTI 유형", "Daily motivation tips #shorts"), false);
  assert.equal(refMatchesQuery("30대 이직", "2030 공감"), false);
  assert.equal(refMatchesQuery("30대 이직", "30대 직장인 현실"), true);
  // Decomposed (NFD) Korean reads like the usual form.
  assert.equal(refMatchesQuery("퇴사", "퇴사 브이로그".normalize("NFD")), true);
  assert.equal(refMatchesQuery("퇴사".normalize("NFD"), "점심 메뉴"), false);
});
