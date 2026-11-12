import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("performance screens read metrics per date window, never every hourly observation", () => {
  for (const file of ["components/content-performance-dashboard.tsx", "components/content-packaging-workspace.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /listAllRecordsOfType\(accessToken, "content_metric"\)|recentAllRecordsOfType\(accessToken, "content_metric"\)/, file);
    assert.match(source, /listMetricWindow\(accessToken/, file);
  }
  const route = readFileSync("app/api/v1/content/metrics/route.ts", "utf8");
  assert.match(route, /await authenticateRequest\(request\)/);
  assert.match(route, /actor\.supabase\.rpc\("os_content_metric_window"/, "runs with the caller's row policies");
  const sql = readFileSync("supabase/migrations/20261029100000_content_metric_window.sql", "utf8");
  assert.match(sql, /security invoker/);
  assert.match(sql, /distinct on \(identity, platform\) id from keyed where mode = 'cumulative'/);
  assert.match(sql, /order by identity, platform, measured desc/);
  assert.match(sql, /revoke all on function public\.os_content_metric_window\(timestamptz, timestamptz\) from public, anon/);
});

test("channel snapshots leave the window read and come only with ?snapshots=1, for posts published in the dates", () => {
  const route = readFileSync("app/api/v1/content/metrics/route.ts", "utf8");
  assert.match(route, /actor\.supabase\.rpc\("os_content_metric_window_v2", \{ \.\.\.window, p_snapshots: snapshots \}\)/);
  assert.match(route, /if \(error\?\.code === "PGRST202"\)/, "until the migration is in, v1 answers and the split happens in the route");
  const sql = readFileSync("supabase/migrations/20261112220000_content_metric_window_v2.sql", "utf8");
  assert.match(sql, /where not p_snapshots and r\.record_type = 'content_metric'/);
  assert.match(sql, /where p_snapshots and r\.record_type = 'content_metric' and r\.archived_at is null and r\.metadata->>'channelSnapshotVersion' = '1'/);
  assert.match(sql, /r\.metadata->>'publishedAt' >= to_char\(p_from/);
  assert.match(sql, /security invoker/);
  assert.match(sql, /revoke all on function public\.os_content_metric_window_v2\(timestamptz, timestamptz, boolean\) from public, anon/);
  assert.match(readFileSync("supabase/rollback/20261112220000_content_metric_window_v2.down.sql", "utf8"), /drop function if exists public\.os_content_metric_window_v2/);
  const page = readFileSync("components/content-performance-dashboard.tsx", "utf8");
  assert.match(page, /listMetricWindow\(accessToken, from, to, true\)/, "경과일 비교 asks for its snapshots itself");
  assert.match(readFileSync("lib/api-client.ts", "utf8"), /if \(snapshots\) params\.set\("snapshots", "1"\);/);
});
