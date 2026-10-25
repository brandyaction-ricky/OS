import assert from "node:assert/strict";
import test from "node:test";
import { activeRuns, salesRuns } from "../lib/kpi-runs.ts";

const pay = (product, day, amount, canceled = 0) => ({ product, day, amount, canceled });

test("a cohort course splits into rounds where sales pause for two weeks", () => {
  const runs = salesRuns([
    pay("AI 문샷 챌린지", "2026-09-28", 1_500_000), pay("AI 문샷 챌린지", "2026-10-04", 1_500_000, 1_500_000),
    pay("AI 문샷 챌린지", "2026-11-20", 1_500_000), pay("AI 문샷 챌린지", "2026-11-25", 1_500_000),
  ]);
  assert.deepEqual(runs.map(r => [r.from, r.to, r.count, r.net, r.canceledCount]), [
    ["2026-11-20", "2026-11-25", 2, 3_000_000, 0],
    ["2026-09-28", "2026-10-04", 2, 1_500_000, 1],
  ]);
  assert.equal(runs[1].key, "AI 문샷 챌린지::2026-09-28");
});

test("an always-on product becomes one round per month; products never mix", () => {
  // Sold every week or so, never pausing two weeks: cut by month once it runs past 60 days.
  const days = ["2026-08-03", "2026-08-12", "2026-08-22", "2026-09-01", "2026-09-10", "2026-09-20", "2026-09-30", "2026-10-08"];
  const runs = salesRuns([...days.map(day => pay("정밀 진단", day, 63_000)), pay("문샷", "2026-09-10", 10)]);
  assert.deepEqual(runs.filter(r => r.product === "정밀 진단").map(r => [r.from, r.to, r.count]), [
    ["2026-10-08", "2026-10-08", 1], ["2026-09-01", "2026-09-30", 4], ["2026-08-03", "2026-08-22", 3],
  ]);
  assert.equal(runs.filter(r => r.product === "문샷").length, 1);
});

test("a split day set by a person cuts a round that sold without a pause", () => {
  const rows = ["2026-10-01", "2026-10-05", "2026-10-09", "2026-10-13"].map(day => pay("문샷", day, 100));
  assert.equal(salesRuns(rows).length, 1);
  assert.deepEqual(salesRuns(rows, { "문샷": ["2026-10-09"] }).map(r => [r.from, r.to]), [["2026-10-09", "2026-10-13"], ["2026-10-01", "2026-10-05"]]);
});

test("meetings look at rounds still selling or whose course is not over, else the latest", () => {
  const runs = [{ from: "2026-09-28", to: "2026-10-04", courseTo: "2026-11-30" }, { from: "2026-07-01", to: "2026-07-10" }];
  assert.equal(activeRuns(runs, "2026-10-25").length, 1);
  assert.deepEqual(activeRuns([{ from: "2026-07-01", to: "2026-07-10" }, { from: "2026-08-01", to: "2026-08-05" }], "2026-10-25").map(r => r.from), ["2026-08-01"]);
  assert.equal(activeRuns([{ from: "2026-10-01", to: "2026-10-20" }], "2026-10-25").length, 1);
});
