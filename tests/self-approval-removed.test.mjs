import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const file = "20261018100000_remove_self_approval_block.sql";

test("approvers may approve their own work; authority, named approver and publisher rules stay", async () => {
  const [sql, manifest] = await Promise.all([read(`supabase/migrations/${file}`), read("supabase/migration-baseline.json").then(JSON.parse)]);
  const code = sql.replace(/^--.*$/gm, "");
  assert.doesNotMatch(code, /is distinct from p_author|agent_owner|OS_INDEPENDENT_APPROVAL_REQUIRED|p_approver = auth\.uid\(\)/);
  assert.match(code, /approval\.kind = 'approver'/);
  assert.match(code, /kind = 'delegate'/);
  assert.match(code, /actor\.role = 'admin'/);
  assert.match(code, /prop\.requested_approver_id<>u and not\(public\.os_is_admin\(\)/);
  assert.match(code, /p\.canonical_publisher\s+\) then raise exception 'OS_CANONICAL_PUBLISHER_REQUIRED'/);
  assert.doesNotMatch(code, /os_fin_|\b(?:drop table|drop column|drop function|truncate|grant|revoke|alter table)\b/i);
  const entry = manifest.forwardMigrations.find((item) => item.file === file);
  assert.equal(entry?.sha256, createHash("sha256").update(sql).digest("hex"));
  assert.equal(entry?.requiresApproval, true);
  assert.equal(entry?.productionApprovedAt, null);
  assert.deepEqual(entry?.appliedEnvironments, ["development"]);
});

test("app code no longer blocks an approver on their own work", async () => {
  const files = ["components/content-radar-workspace.tsx", "components/review-inbox.tsx", "components/knowledge-proposal-review.tsx", "components/knowledge/canon.tsx", "app/api/v1/documents/proposals/route.ts", "lib/knowledge/access.ts", "lib/knowledge/demo.ts"];
  const code = (await Promise.all(files.map(read))).join("\n");
  assert.doesNotMatch(code, /created_by !== profile\?\.id|owner_id !== profile\?\.id|author_id !== profile\?\.id\)\)|designatedApprover|작성자는 (자신의|승인할 수 없)|작성자와 다른/);
  const request = await read("app/api/v1/content/appeals/request/route.ts");
  assert.match(request, /if \(!approvers\.length\) throw/);
});
