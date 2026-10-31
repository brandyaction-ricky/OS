import assert from "node:assert/strict";
import test from "node:test";
import { adMetrics, adNumber, pastAdsForAi, rankAds } from "../lib/youtube-process/ad-results.ts";

const result = (numbers, appeal = "이유") => ({ id: appeal, from: "2026-10-01", to: "2026-10-07", spend: 0, impressions: 0, clicks: 0, plays3s: 0, purchases: 0, revenue: 0, note: "", at: "t", by: "리키", appeal, headCopy: "카피", ...numbers });

test("numbers copied from Ads Manager read as numbers, and the rates come from them", () => {
  assert.equal(adNumber("₩1,234,000"), 1234000);
  assert.equal(adNumber("1.2만"), 12000);
  assert.equal(adNumber("38회"), 38);
  assert.equal(adNumber("없음"), null);
  const m = adMetrics({ spend: 100000, impressions: 50000, clicks: 750, plays3s: 12000, purchases: 4, revenue: 236000 });
  assert.equal(m.cpm, 2000); assert.equal(m.ctr, 0.015); assert.equal(m.cpa, 25000); assert.equal(m.roas, 2.36); assert.equal(m.view3s, 0.24);
  // Nothing to divide by is not a zero.
  assert.deepEqual(adMetrics({ spend: 5000, impressions: 0, clicks: 0, plays3s: 0, purchases: 0, revenue: 0 }), { cpm: null, ctr: null, cpa: null, roas: 0, view3s: null });
});

test("the next ad reads the best three and the weakest two, best return first", () => {
  const rows = [["A", 1, 1000], ["B", 3, 300], ["C", 0.5, 2000], ["D", 2, 500], ["E", 0.2, 5000], ["F", 1.5, 800]]
    .map(([name, roas, spend]) => ({ projectId: name, title: name, result: result({ spend, revenue: spend * roas, purchases: 1, impressions: 1000 }, name) }));
  rows.push({ projectId: "G", title: "G", result: result({}, "G") });
  assert.deepEqual(rankAds(rows).map(row => row.title), ["B", "D", "F", "A", "C", "E"]);
  const forAi = pastAdsForAi(rows);
  assert.equal(forAi.best.length, 3); assert.equal(forAi.weak.length, 2);
  assert.match(forAi.best[0], /「B」 구매 이유: B · 헤드 카피: 카피 · ROAS 3.00배 · CPA 300원/);
  assert.match(forAi.weak.at(-1), /「E」/);
  assert.equal(pastAdsForAi([]), null);
});
