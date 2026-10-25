import assert from "node:assert/strict";
import test from "node:test";
import { formatKpiValue, kpiLogLine, kpiLogTitle, kpiProgress, monthRange, validMonth } from "../lib/kpi.ts";

test("month range covers the whole month, leap years included", () => {
  assert.deepEqual(monthRange("2026-10"), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(monthRange("2028-02"), { from: "2028-02-01", to: "2028-02-29" });
  assert.equal(validMonth("2026-13"), false);
  assert.equal(validMonth("2026-10"), true);
});

test("values and progress read the way the screen and the log show them", () => {
  assert.equal(formatKpiValue(486900, "원"), "486,900원");
  assert.equal(formatKpiValue(12, "건"), "12건");
  assert.equal(formatKpiValue(null, "원"), "—");
  assert.equal(kpiProgress(486900, 15000000), 3.2);
  assert.equal(kpiProgress(5, 0), null);
  assert.equal(kpiProgress(null, 10), null);
});

test("each business keeps a monthly log in its own wiki folder, one dated line per change", () => {
  assert.deepEqual(kpiLogTitle("myin", "2026-10"), { title: "KPI 로그 · 마이인 · 2026-10", folder: "02_Wiki/마이인/운영/KPI 로그" });
  assert.equal(kpiLogTitle("edu", "2026-10").folder, "02_Wiki/브랜디에듀/운영/KPI 로그");
  assert.equal(kpiLogLine(new Date("2026-10-24T21:30:00Z"), "자동", "매출 누적 486,900원"), "- 2026-10-25 06:30 · 자동 · 매출 누적 486,900원");
});
