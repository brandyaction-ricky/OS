import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("fourth handoff exposes one advertising performance workspace", async () => {
  const [navigation, router, workspace] = await Promise.all([
    read("lib/navigation.ts"),
    read("app/(os)/[stage]/[page]/page.tsx"),
    read("components/ad-performance-workspace.tsx"),
  ]);
  assert.match(navigation, /광고 성과/);
  assert.match(navigation, /자사몰 어드민/);
  assert.match(router, /AdPerformanceWorkspace/);
  for (const label of ["광고비", "전환 매출", "ROAS", "CPA", "Meta Ads", "Google Ads"]) assert.match(workspace, new RegExp(label));
  assert.doesNotMatch(workspace, /META_ADS_ACCESS_TOKEN|GOOGLE_ADS_CLIENT_SECRET/);
});

test("advertising credentials stay server-only and sync is read-only", async () => {
  const [server, route, cron] = await Promise.all([
    read("lib/server/ad-performance.ts"),
    read("app/api/v1/ad-performance/route.ts"),
    read("app/api/v1/indexing/cron/route.ts"),
  ]);
  assert.match(server, /graph\.facebook\.com/);
  assert.match(server, /googleads\.googleapis\.com/);
  assert.match(server, /FROM customer/);
  assert.doesNotMatch(server, /campaigns:mutate|adGroups:mutate|ads:mutate/);
  assert.match(route, /actor\.role !== "admin"/);
  assert.match(cron, /trailingDateRange\(7\)/);
});

test("advertising database is daily, deduplicated and RLS protected", async () => {
  const migration = await read("supabase/migrations/202608290006_ad_performance.sql");
  assert.match(migration, /os_ad_performance_daily/);
  assert.match(migration, /unique \(provider, brand_key, metric_date\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke insert, update, delete/);
});
