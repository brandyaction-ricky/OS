import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const file = "20261013093500_agent_trash_and_owner_canonical_apply.sql";

test("AI trash and owner-key canonical apply reuse the human rules under the key owner", async () => {
  const [sql, manifest] = await Promise.all([read(`supabase/migrations/${file}`), read("supabase/migration-baseline.json").then(JSON.parse)]);
  assert.match(sql, /os_assert_agent_write_access\(p_agent_key_id, p_organization_id, 'knowledge\.delete'\)[\s\S]*os_set_document_status\(p_document_id, 'archived'/);
  assert.match(sql, /prop\.agent_key_id is distinct from p_agent_key_id[\s\S]*os_is_designated_approver\(k\.owner_user_id\)[\s\S]*'proposal\.decide'/);
  assert.match(sql, /revoke all on function public\.os_agent_as_owner\(uuid\) from public, anon, authenticated/);
  for (const fn of ["os_agent_trash_document(uuid, uuid, uuid, text)", "os_agent_apply_own_proposal(uuid, uuid, uuid)"]) {
    assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon, authenticated`));
    assert.ok(sql.includes(`grant execute on function public.${fn} to service_role`));
  }
  assert.doesNotMatch(sql, /\b(?:drop |truncate|delete from)/i);
  const entry = manifest.forwardMigrations.find((item) => item.file === file);
  assert.equal(entry?.sha256, createHash("sha256").update(sql).digest("hex"));
  assert.equal(entry?.requiresApproval, true);
});

test("route: agent trash goes through the owner rule; only the designated approver's key applies canonical edits", async () => {
  const route = await read("app/api/v1/knowledge-documents/route.ts");
  assert.doesNotMatch(route, /AI 키로 문서를 삭제할 수 없습니다/);
  assert.match(route, /actor\.type === "agent"\) \{[\s\S]*rpc\("os_agent_trash_document"/);
  assert.match(route, /actor\.type === "agent" && await isDesignatedApprover\(actor\.ownerId\)[\s\S]*rpc\("os_agent_apply_own_proposal"[\s\S]*applied: true/);
  // apply failure keeps the proposal and the old 202 response
  assert.match(route, /proposal left open"[\s\S]*status: 202/);
});
