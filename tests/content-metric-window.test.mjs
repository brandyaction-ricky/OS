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
