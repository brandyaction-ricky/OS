import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { appealReadinessMissing } from "../lib/content-appeal-readiness.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("appeal approval request needs all four fields and a linked market video", () => {
  const topic = { source_url: null, metadata: { audience: "초보 창업자", entryLanguage: "사업 시작", hierarchy: "창업", evidence: "근거 메모만" } };
  assert.deepEqual(appealReadinessMissing(topic), ["시장 근거 영상 주소"]);
  assert.deepEqual(appealReadinessMissing({ ...topic, source_url: "https://youtube.com/watch?v=demo" }), []);
  assert.equal(appealReadinessMissing({ source_url: "", metadata: {} }).length, 4);
});

test("appeal comments are additive, service-only and current-set-scoped", async () => {
  const [sql, api, manifest] = await Promise.all([
    read("supabase/migrations/20261003162000_appeal_candidate_comments.sql"),
    read("app/api/v1/content/appeals/comments/route.ts"),
    read("supabase/migration-baseline.json").then(JSON.parse),
  ]);
  assert.match(sql, /create table if not exists public\.os_appeal_candidate_comments/);
  assert.match(sql, /grant select, insert on public\.os_appeal_candidate_comments to service_role/);
  assert.doesNotMatch(sql, /\b(?:update|delete|drop|truncate)\b/i);
  assert.match(api, /candidateSetVersion/);
  assert.match(api, /appeal\.version !== input\.expectedVersion/);
  assert.match(api, /actor\.supabase\.from\("os_records"\)/);
  const entry = manifest.forwardMigrations.find((item) => item.file === "20261003162000_appeal_candidate_comments.sql");
  assert.equal(entry?.requiresApproval, true);
  assert.equal(entry?.developmentApprovedAt, "2026-10-05");
  assert.equal(entry?.productionApprovedAt, "2026-10-05");
  assert.deepEqual(entry?.appliedEnvironments, ["development", "production"]);
});

test("batch decision and notifications retain authorization and version gates", async () => {
  const [ui, decision, request] = await Promise.all([
    read("components/content-radar-workspace.tsx"),
    read("app/api/v1/content/appeals/decide/route.ts"),
    read("app/api/v1/content/appeals/request/route.ts"),
  ]);
  assert.match(ui, /entries: indices\.map/);
  assert.match(ui, /selectedAppeals\.size/);
  assert.match(decision, /os_decide_appeals/);
  assert.match(request, /appealReadinessMissing\(topic\)/);
  assert.match(request, /os_can_approve/);
  assert.match(request, /os_enqueue_work_notification/);
});
