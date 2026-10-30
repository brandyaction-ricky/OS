import assert from "node:assert/strict";
import test from "node:test";
import { emptyCardDraft } from "../lib/cardnews/formats.ts";
import { canonVersion, fixList, graduatedTwice, GRIND_KINDS, mergedGrades, passes, resultKey, runSummary } from "../lib/canon-grind/grind.ts";

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

test("a 정본's version: its 정본 묶음 line, else its 상태 line, else the document version", () => {
  assert.equal(canonVersion("> **정본 묶음: v0.1 (2026-10-30).**", 3), "v0.1");
  assert.equal(canonVersion("> 상태: v0.7 (2026-10-29, 대표 승인).", 8), "v0.7");
  assert.equal(canonVersion("> 상태: 초안 v0.2", 2), "v0.2");
  assert.equal(canonVersion("본문만", 5), "doc v5");
});
