import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("shared account migration is gated, additive, and audited", async () => {
  const file = "20261003174000_shared_agent_accounts.sql";
  const [sql, manifest] = await Promise.all([
    read(`supabase/migrations/${file}`), read("supabase/migration-baseline.json").then(JSON.parse),
  ]);
  const entry = manifest.forwardMigrations.find((item) => item.file === file);
  assert.equal(entry?.sha256, createHash("sha256").update(sql).digest("hex"));
  assert.equal(entry?.requiresApproval, true);
  assert.deepEqual(entry?.appliedEnvironments, []);
  assert.match(sql, /add column if not exists is_shared_account boolean not null default false/);
  assert.match(sql, /member\.shared_account/);
  assert.match(sql, /revoke all on function public\.os_set_shared_account/);
  assert.doesNotMatch(sql, /\b(?:delete from|truncate|drop table)\b/i);
});

test("shared key issuance requires a reason on the server and existing keys remain valid", async () => {
  const [keys, request, ui, members] = await Promise.all([
    read("app/api/v1/agent-keys/route.ts"),
    read("app/api/v1/agent-keys/reissue-request/route.ts"),
    read("components/agent-key-manager.tsx"),
    read("app/api/v1/members/route.ts"),
  ]);
  assert.match(keys, /owner\.is_shared_account && !input\.reason/);
  assert.match(keys, /SHARED_ACCOUNT_REASON_REQUIRED/);
  assert.match(keys, /agent_key\.issued_shared/);
  assert.doesNotMatch(keys, /update\(\{ active: false[^}]*\}\).*owner\.is_shared_account/s);
  assert.match(request, /recipient\.is_shared_account/);
  assert.match(request, /os_enqueue_work_notification/);
  assert.match(ui, /공용 계정 · 사용자를 특정할 수 없음/);
  assert.match(ui, /본인 계정으로 재발급 요청/);
  assert.match(members, /os_set_shared_account/);
});
