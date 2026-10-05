import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";
import { revenueNet } from "../lib/revenue-metrics.ts";
import { measuredMedian, measuredNumber, measuredSum, safeRatio, formatMoney, formatRatio } from "../lib/metric-format.ts";
import { aggregateAdMetrics } from "../lib/ad-metrics.ts";
import { connectionState } from "../lib/connection-status.ts";
import { findPage, findStage, NAV_STAGES } from "../lib/navigation.ts";

test("unknown numeric values never become zero, but an explicit zero stays measured", () => {
  for (const value of [null, undefined, "", "  ", NaN, Infinity, true, {}, []]) assert.equal(measuredNumber(value), null);
  assert.equal(measuredNumber("0"), 0);
  assert.equal(measuredSum([]), null);
  assert.equal(measuredSum([null, undefined]), null);
  assert.equal(measuredSum([0]), 0);
  assert.equal(formatMoney(null), "—");
  assert.equal(formatMoney(0), "0만원");
  assert.equal(formatMoney(-10000), "-1만원");
});
test("zero or missing denominators are undefined ratios, not zero performance", () => {
  for (const denominator of [0, null, undefined, "", NaN]) assert.equal(safeRatio(100, denominator), null);
  assert.equal(safeRatio(null, 100), null);
  assert.equal(safeRatio(0, 100), 0);
  assert.equal(safeRatio(30, 100, 100), 30);
  assert.equal(formatRatio(safeRatio(10, 0)), "—");
});
test("ad aggregates keep their fields, distinguish no rows and zero spend, and calculate real ratios", () => {
  const empty = aggregateAdMetrics([]);
  assert.equal(empty.spend, null); assert.equal(empty.sampleCount, 0); assert.equal(empty.roas, null);
  const zero = aggregateAdMetrics([{ spend: 0, attributed_revenue: 0, conversions: 0, impressions: 100, clicks: 0 }]);
  assert.equal(zero.spend, 0); assert.equal(zero.roas, null); assert.equal(zero.cpa, null); assert.equal(zero.ctr, 0);
  const real = aggregateAdMetrics([{ spend: 100, attributed_revenue: 300, conversions: 2, impressions: 1000, clicks: 50 }]);
  assert.equal(real.roas, 3); assert.equal(real.cpa, 50); assert.equal(real.ctr, 5);
});
const now = Date.parse("2026-10-03T12:00:00Z");
const check = { configured: true, lastOkAt: "2026-10-03T11:00:00Z", failures24h: 0, blockedJobs: 0, latestFailed: false, historyAvailable: true };
test("configured-only, stale and unavailable evidence never claim a verified connection", () => {
  assert.equal(connectionState({ ...check, lastOkAt: null }, now), "unverified");
  assert.equal(connectionState({ ...check, historyAvailable: false }, now), "unverified");
  assert.equal(connectionState({ ...check, failures24h: null }, now), "unverified");
  assert.equal(connectionState({ ...check, configured: false }, now), "missing");
  assert.equal(connectionState({ ...check, lastOkAt: "2026-10-01T12:00:00Z" }, now), "stale");
  assert.equal(connectionState(check, now), "verified");
});
test("failed work wins over a successful recent probe and even missing configuration", () => {
  for (const input of [{ failures24h: 1 }, { blockedJobs: 1201 }, { latestFailed: true }, { configured: false, blockedJobs: 1 }])
    assert.equal(connectionState({ ...check, ...input }, now), "error");
});
test("existing settings URLs share one menu, heading, breadcrumb and browser title name", () => {
  for (const path of ["/settings/connections", "/settings/monitoring", "/settings/channels"]) {
    assert.equal(findPage(path).label, "작동 상태"); assert.equal(findStage(path).id, "settings");
  }
  assert.equal(findPage("/settings/monitoring").navHref, "/settings/connections");
  assert.equal(NAV_STAGES.find(stage => stage.id === "settings").pages.filter(page => page.label === "작동 상태").length, 1);
  assert.equal(findPage("/performance/connections").label, "작동 상태");
});
test("loading and failed boundaries suppress numeric and empty-state children", async () => {
  const source = await readFile(new URL("../components/workspace-load-state.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const compiled = { exports: {} };
  runInNewContext(code, { module: compiled, exports: compiled.exports, require: name => { assert.equal(name, "react/jsx-runtime"); return jsx; } });
  const { WorkspaceLoadState } = compiled.exports;
  const child = React.createElement("div", null, "0개 · 깨진 링크 없음");
  const loading = renderToStaticMarkup(React.createElement(WorkspaceLoadState, { loading: true }, child));
  assert.match(loading, /aria-busy="true"/); assert.doesNotMatch(loading, /0개|깨진 링크 없음/);
  const error = renderToStaticMarkup(React.createElement(WorkspaceLoadState, { loading: false, error: "조회 실패", retry() {} }, child));
  assert.match(error, /role="alert"/); assert.match(error, /다시 불러오기/); assert.doesNotMatch(error, /0개|깨진 링크 없음/);
  assert.match(renderToStaticMarkup(React.createElement(WorkspaceLoadState, { loading: false }, child)), /0개/);
});

test("legacy gross revenue derivation remains correct while absent net revenue stays unknown", () => {
  assert.equal(revenueNet({ amount: null, metadata: {} }), null);
  assert.equal(revenueNet({ amount: 0, metadata: {} }), 0);
  assert.equal(revenueNet({ amount: null, metadata: { gross: 100, cancel: 20, refund: 5 } }), 75);
  assert.equal(revenueNet({ amount: 100, metadata: { net: 0, gross: 100 } }), 0);
});

test("indexing retry does not erase recorded attempt failures", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261002152810_connection_check_evidence.sql", import.meta.url), "utf8");
  const reader = await readFile(new URL("../lib/server/connection-checks.ts", import.meta.url), "utf8");
  assert.match(sql, /after insert or update of status on public.os_embedding_jobs/);
  assert.match(sql, /old.status is distinct from new.status/);
  assert.match(sql, /security invoker/);
  assert.match(sql, /revoke all on function/);
  assert.match(reader, /os_connection_checks.*count: "exact".*eq\("ok", false\).*gte\("checked_at", since\)/);
  assert.doesNotMatch(reader, /os_embedding_jobs.*gte\("finished_at", since\)/);
});

test("median summaries do not treat missing measurements as zero", () => {
  assert.equal(measuredMedian([null, undefined]), null);
  assert.equal(measuredMedian([null, 0]), 0);
  assert.equal(measuredMedian([0, 10, 100]), 10);
  assert.equal(measuredMedian([0, 10]), 5);
});
