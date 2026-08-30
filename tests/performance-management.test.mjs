import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("performance brand and month filters persist across all stage pages", async () => {
  const [filters, shell, layout, revenue, ads, overview] = await Promise.all([
    read("components/performance-filter-context.tsx"),
    read("components/app-shell.tsx"),
    read("app/(os)/layout.tsx"),
    read("components/performance-workspaces.tsx"),
    read("components/ad-performance-workspace.tsx"),
    read("components/growth-dashboard.tsx"),
  ]);
  assert.match(filters, /brandy-performance-filters/);
  assert.match(filters, /localStorage\.setItem/);
  assert.match(shell, /pathname\.startsWith\("\/performance"\).*PerformanceFilterBar/s);
  assert.match(layout, /PerformanceFilterProvider/);
  for (const source of [revenue, ads, overview]) assert.match(source, /usePerformanceFilters/);
});

test("funnels support editable stage names, values, order, addition and deletion", async () => {
  const workspace = await read("components/performance-workspaces.tsx");
  for (const marker of ["단계 추가", "단계 편집", "moveStage", "Trash2", "updateRecord", "metadata.stages"]) {
    assert.match(workspace, new RegExp(marker.replace(".", "\\.")));
  }
  assert.match(workspace, /stages\.length <= 2/);
  assert.doesNotMatch(workspace, /const views=numberValue/);
});

test("revenue and advertising CSV imports are validated server-side", async () => {
  const [parser, route, client, revenue, ads] = await Promise.all([
    read("lib/performance-csv.ts"),
    read("app/api/v1/performance/import/route.ts"),
    read("lib/api-client.ts"),
    read("components/performance-workspaces.tsx"),
    read("components/ad-performance-workspace.tsx"),
  ]);
  assert.match(parser, /최대 2,000행/);
  assert.match(parser, /parseRevenueCsv/);
  assert.match(parser, /parseAdCsv/);
  assert.match(route, /z\.discriminatedUnion/);
  assert.match(route, /actor\.role !== "admin"/);
  assert.match(route, /onConflict: "provider,brand_key,metric_date"/);
  assert.match(client, /importPerformanceCsv/);
  assert.match(revenue, /CSV 가져오기/);
  assert.match(ads, /CSV 가져오기/);
});

test("performance alerts share one rule with meeting preparation", async () => {
  const [signals, dashboard, meeting, weekly] = await Promise.all([
    read("lib/performance-signals.ts"),
    read("components/growth-dashboard.tsx"),
    read("app/api/v1/meeting-prep/route.ts"),
    read("components/performance-workspaces.tsx"),
  ]);
  assert.match(signals, /2주 연속 0/);
  assert.match(signals, /conversionMetric \? 20 : 10/);
  assert.match(signals, /목표 대비 10%/);
  for (const source of [dashboard, meeting, weekly]) assert.match(source, /buildPerformanceSignal/);
});

test("performance QA polish covers empty states, units, terminology and bad routes", async () => {
  const [revenue, ads, overview, router] = await Promise.all([
    read("components/performance-workspaces.tsx"),
    read("components/ad-performance-workspace.tsx"),
    read("components/growth-dashboard.tsx"),
    read("app/(os)/[stage]/[page]/page.tsx"),
  ]);
  assert.match(revenue, /아직 입력된 KPI가 없습니다/);
  assert.match(revenue, /아직 연결된 관리자 링크가 없습니다/);
  assert.match(revenue, /일별 매출 추이/);
  assert.match(revenue, /유입원별 매출/);
  assert.match(ads, /아직 연결되지 않았습니다/);
  assert.match(ads, /10_000/);
  assert.doesNotMatch(`${ads}\n${overview}`, /매출 원장|브랜드 관리자/);
  assert.match(router, /resolved\.stage === "performance".*redirect\("\/performance\/overview"\)/s);
});
