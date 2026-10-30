import assert from "node:assert/strict";
import test from "node:test";
import { emptyCardDraft } from "../lib/cardnews/formats.ts";
import { fixList, graduatedTwice, mergedGrades, passes, resultKey, runSummary } from "../lib/cardnews/grind.ts";

// 카드뉴스 정본 다듬기 (정본 §8 · §9): the 평가표 merge, the graduation and the 고칠 점.
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
  assert.equal(runSummary(run("1", good)).graduated, true);
  assert.equal(runSummary(run("1", { [resultKey("a", "quote")]: good[resultKey("a", "quote")] })).graduated, false, "one draft not scored");
  const failed = run("1", good); failed.results[1] = { ...failed.results[1], draft: undefined, error: "x" };
  assert.equal(runSummary(failed).graduated, false, "a draft GPT could not make");
  const long = run("1", good); long.results[0].draft.slides[1].fields.text = "가".repeat(60);
  assert.equal(runSummary(long).findings, 1);
  assert.equal(runSummary(long).graduated, false);
  assert.equal(graduatedTwice([run("2026-10-30T01", good), run("2026-10-30T02", good)]), true);
  assert.equal(graduatedTwice([run("2026-10-30T01", good), run("2026-10-30T02", {})]), false);
  assert.equal(graduatedTwice([run("2026-10-30T01", good), run("2026-10-30T02", good, { state: "running" })]), false, "a run still drawing is not counted");
});

test("고칠 점: a criterion flagged on two drafts is the 정본's problem, on one draft that draft's", () => {
  const scores = {
    [resultKey("a", "quote")]: { p: score("p", { ...all("상"), 4: "하" }, { 4: "딱딱해요" }) },
    [resultKey("b", "quote")]: { p: score("p", { ...all("상"), 4: "중", 1: "중" }, { 4: "AI 같아요", 1: "평범해요" }) },
  };
  const list = fixList(run("1", scores));
  assert.deepEqual(list.map(row => [row.n, row.drafts, row.canonIssue]), [[4, 2, true], [1, 1, false]]);
  assert.deepEqual(list[0].notes.map(note => note.note), ["딱딱해요", "AI 같아요"]);
});
