import assert from "node:assert/strict";
import test from "node:test";
import { emptyCardDraft } from "../lib/cardnews/formats.ts";
import { canonVersion, fixList, graduatedTwice, GRIND_KINDS, mergedGrades, passes, resultKey, runSummary, scriptBundle, scriptBundles, scriptFixes, scriptGraduated } from "../lib/canon-grind/grind.ts";
import { checkColumnHtml } from "../lib/seo-column.ts";

// 정본 다듬기 (카드뉴스 정본 §8 · §9, 설계서 §9): the 평가표 merge, the graduation and the 고칠 점, for 카드뉴스 and 숏폼 대본.
const all = grade => ({ 1: grade, 2: grade, 3: grade, 4: grade, 5: grade, 6: grade });
const score = (name, grades, notes = {}) => ({ name, grades, notes, at: "2026-10-30T00:00:00Z" });
const filled = () => {
  const draft = emptyCardDraft("quote", "d", "x", "t");
  draft.slides = draft.slides.map(slide => ({ ...slide, fields: Object.fromEntries(Object.keys(slide.fields).map(key => [key, "짧은 문장"])) }));
  return { format: draft.format, slides: draft.slides, caption: "캡션", hashtags: ["a", "b", "c"] };
};
const run = (at, scores, extra = {}) => ({ id: at, canon: "v0.1", at, by: "p", byName: "PD", model: "gpt-6.1-sol", formats: ["quote"], state: "done",
  results: ["a", "b"].map(item => ({ key: resultKey(item, "quote"), itemId: item, title: item, format: "quote", draft: filled() })), scores, ...extra });

test("a draft's grade is the lowest any full scorer gave; it passes at 중 or better with four 상", () => {
  assert.equal(mergedGrades({ a: score("a", { 1: "상" }) }), null, "a half-done score does not count");
  const merged = mergedGrades({ a: score("a", all("상")), b: score("b", { ...all("상"), 4: "중" }) });
  assert.equal(merged[4], "중");
  assert.ok(passes(merged));
  assert.ok(!passes({ ...merged, 1: "중", 2: "중" }), "only three 상");
  assert.ok(!passes({ ...all("상"), 6: "하" }), "a 하 fails");
});

test("a run graduates when every draft is scored and 80% pass with no automatic finding; the 정본 needs two in a row", () => {
  const good = { [resultKey("a", "quote")]: { p: score("p", all("상")) }, [resultKey("b", "quote")]: { p: score("p", all("상")) } };
  assert.equal(runSummary(run("1", good), "card").graduated, true);
  assert.equal(runSummary(run("1", { [resultKey("a", "quote")]: good[resultKey("a", "quote")] }), "card").graduated, false, "one draft not scored");
  const failed = run("1", good); failed.results[1] = { ...failed.results[1], draft: undefined, error: "x" };
  assert.equal(runSummary(failed, "card").graduated, false, "a draft GPT could not make");
  const long = run("1", good); long.results[0].draft.slides[1].fields.text = "가".repeat(60);
  assert.equal(runSummary(long, "card").findings, 1);
  assert.equal(runSummary(long, "card").graduated, false);
  assert.equal(graduatedTwice([run("2026-10-30T01", good), run("2026-10-30T02", good)], "card"), true);
  assert.equal(graduatedTwice([run("2026-10-30T01", good), run("2026-10-30T02", {})], "card"), false);
  assert.equal(graduatedTwice([run("2026-10-30T01", good), run("2026-10-30T02", good, { state: "running" })], "card"), false, "a run still drawing is not counted");
});

test("고칠 점: a criterion flagged on two drafts is the 정본's problem, on one draft that draft's", () => {
  const scores = {
    [resultKey("a", "quote")]: { p: score("p", { ...all("상"), 4: "하" }, { 4: "딱딱해요" }) },
    [resultKey("b", "quote")]: { p: score("p", { ...all("상"), 4: "중", 1: "중" }, { 4: "AI 같아요", 1: "평범해요" }) },
  };
  const list = fixList(run("1", scores), "card");
  assert.deepEqual(list.map(row => [row.n, row.drafts, row.canonIssue]), [[4, 2, true], [1, 1, false]]);
  assert.deepEqual(list[0].notes.map(note => note.note), ["딱딱해요", "AI 같아요"]);
});

test("숏폼 대본: its 평가표 is the 정본 §10 판정 검사, and the automatic check is the 정본 기계 검사", () => {
  assert.equal(GRIND_KINDS.short.criteria.length, 6);
  assert.equal(GRIND_KINDS.short.canonTitle, "숏폼 대본 정본");
  const ok = { headCopy: "연봉 올렸는데 또 지쳤다면", hooks: [], insight: "x", formula: "f",
    text: Array.from({ length: 14 }, (_, i) => `연봉이 막아 주는 건 딱 하나예요 ${i}`).join("\n") };
  assert.equal(GRIND_KINDS.short.findings(ok), 0);
  assert.ok(GRIND_KINDS.short.findings({ ...ok, headCopy: "가".repeat(25) }) >= 1, "a 헤드 카피 over 20 letters");
  assert.ok(GRIND_KINDS.short.findings({ ...ok, text: ok.text + "\n" + "가".repeat(35) }) >= 1, "a line over 30 letters");
  const runShort = { state: "done", results: [{ key: "a:script", itemId: "a", title: "a", format: "script", draft: ok }], scores: { "a:script": { p: score("p", all("상")) } } };
  assert.equal(runSummary(runShort, "short").graduated, true);
});

test("스레드: its 평가표 is the 정본 §7 관문 여섯; the automatic check is the post limit and no OS address in a public post", () => {
  assert.deepEqual(GRIND_KINDS.threads.criteria.map(c => c.name), ["주제", "첫 줄과 본문", "관점의 답", "적용", "근거 · 의미", "읽기 · 형식"]);
  const ok = { posts: ["본문", "관점 댓글", "적용 대댓글"] };
  assert.equal(GRIND_KINDS.threads.findings(ok), 0);
  assert.equal(GRIND_KINDS.threads.findings({ posts: ["가".repeat(501)] }), 1, "a post over 500 letters");
  assert.equal(GRIND_KINDS.threads.findings({ posts: [] }), 1, "no post at all");
  assert.equal(GRIND_KINDS.threads.findings({ posts: ["본문", "https://brandyaction-os.vercel.app/knowledge?document=x"] }), 1, "an OS address in a public post");
  const run = { state: "done", results: [{ key: "a:posts", itemId: "a", title: "a", format: "posts", draft: ok }], scores: { "a:posts": { p: score("p", all("상")) } } };
  assert.equal(runSummary(run, "threads").graduated, true);
});

test("SEO 칼럼: its 평가표 comes from the 정본 §2–§6 (it has none of its own); the automatic check is the OS column check", () => {
  assert.equal(GRIND_KINDS.column.canonTitle, "SEO 칼럼 만드는 절차 (정본)");
  assert.deepEqual(GRIND_KINDS.column.criteria.map(c => c.n), [1, 2, 3, 4, 5, 6]);
  const bare = { html: "<!DOCTYPE html><html><head><title>t</title></head><body><script>x</script></body></html>" };
  const { unsafe, issues } = checkColumnHtml(bare.html);
  assert.ok(unsafe.length && issues.length);
  assert.equal(GRIND_KINDS.column.findings(bare), unsafe.length + issues.length, "unsafe tags and 구성 gaps both count");
});

test("a 정본's version: its 정본 묶음 line, else its 상태 line, else the document version", () => {
  assert.equal(canonVersion("> **정본 묶음: v0.1 (2026-10-30).**", 3), "v0.1");
  assert.equal(canonVersion("> 상태: v0.7 (2026-10-29, 대표 승인).", 8), "v0.7");
  assert.equal(canonVersion("> 상태: 초안 v0.2", 2), "v0.2");
  assert.equal(canonVersion("집필 입력 계약: threads_editorial_v1\n\n# 쓰레드 자동화 운영 정본\n\n운영 기준 v5.9 · 2026-10-29", 22), "v5.9");
  assert.equal(canonVersion("본문만", 5), "doc v5");
});

test("롱폼 원고: 두 번째 검수 by 정본 묶음, a gate turned back on two 원고 is a 정본 문제, graduation over two 묶음", () => {
  assert.equal(scriptBundle("v2.5 (2026-10-30)"), "v2.5");
  assert.equal(scriptBundle(""), "묶음 모름");
  assert.equal(scriptBundle(null), "묶음 모름");
  const verdict = (projectId, at, bundle, failed) => ({ projectId, title: projectId, at, by: "", bundle, pass: !failed.length,
    gates: [2, 3, 4, 5, 6].map(gate => ({ gate, pass: !failed.includes(gate), items: failed.includes(gate) ? [{ paragraph: 1, quote: "q", grade: "상", reason: `g${gate}`, fix: "" }] : [] })) });
  const verdicts = [verdict("a", "2026-10-30T09:00:00Z", "v2.5", [4, 5]), verdict("b", "2026-10-30T05:00:00Z", "v2.5", [5]), verdict("c", "2026-10-27T00:00:00Z", "v2.4", [])];
  const bundles = scriptBundles(verdicts);
  assert.deepEqual(bundles.map(row => row.bundle), ["v2.5", "v2.4"], "newest 원고 first");
  assert.equal(bundles[0].passed, 0);
  assert.deepEqual(bundles[0].gates.map(row => row.failed), [0, 0, 1, 2, 0]);
  const fixes = scriptFixes(bundles[0].scripts);
  assert.deepEqual(fixes.map(row => [row.gate, row.scripts, row.canonIssue]), [[5, 2, true], [4, 1, false]]);
  assert.equal(fixes[0].notes.length, 2);
  assert.equal(scriptGraduated(bundles), false);
  const good = [verdict("d", "2026-11-02T00:00:00Z", "v2.7", []), verdict("e", "2026-11-01T00:00:00Z", "v2.6", [])];
  assert.equal(scriptGraduated(scriptBundles(good)), true);
  assert.equal(scriptGraduated(scriptBundles([verdict("f", "2026-11-02T00:00:00Z", "묶음 모름", []), good[1]])), false, "an unknown 묶음 never graduates");
});
