import assert from "node:assert/strict";
import test from "node:test";
import { loadSystemOneContentHead as load, recheckSystemOneContentHead as recheck } from "../lib/server/system-one-content-source.ts";
const id = "00000000-0000-4000-8000-000000000001";
const owner = "00000000-0000-4000-8000-000000000002";
const input = { kind: "content_topic", id, expectedVersion: 1 };
function harness() {
  const state = { calls: 0, row: { id, record_type: "content_topic", title: "Synthetic topic", description: "Synthetic material",
    status: "draft", stage: "", brand: "", team: "", owner_id: owner, source_url: null, metadata: { format: "board" },
    version: 1, updated_at: "2026-01-01T00:00:00.000Z", archived_at: null },
    principal: { id: owner, type: "user", active: true, mustChangePassword: false } };
  const deps = { authenticate: async () => { state.calls++; return { principal: state.principal, readHead: async () => state.row }; } };
  return { state, deps };
}
test("topic head has explicit type and no body, judgment or execution permission", async () => {
  const { deps } = harness(); const result = await load(input, deps);
  assert.equal(result.status, "ready"); assert.equal(result.head.kind, "content_topic");
  assert.equal(result.head.executionAllowed, false); assert.equal(result.head.judgment, null);
  assert.equal(result.head.policyStatus, "unverified"); assert.equal("description" in result.head, false);
});
test("rejects document-shaped or unversioned inputs before authentication", async () => {
  for (const bad of [{ ...input, kind: "document" }, { id }, { ...input, expectedVersion: 0 }, { ...input, body: "injected" }]) {
    const { state, deps } = harness(); assert.equal((await load(bad, deps)).code, "invalid_input"); assert.equal(state.calls, 0);
  }
});
for (const [name, change, code] of [
  ["missing", s => { s.row = null; }, "unavailable"],
  ["other owner", s => { s.row.owner_id = id; }, "unavailable"],
  ["archived", s => { s.row.archived_at = "2026-01-01T00:00:00Z"; }, "unavailable"],
  ["different ID", s => { s.row.id = owner; }, "unavailable"],
  ["wrong type", s => { s.row.record_type = "expense"; }, "invalid_metadata"],
  ["stale", s => { s.row.version = 2; }, "stale"],
  ["oversize utf8", s => { s.row.description = "한".repeat(50_000); }, "invalid_metadata"],
  ["inactive", s => { s.principal.active = false; }, "authentication_failed"],
  ["agent", s => { s.principal.type = "agent"; }, "authentication_failed"],
]) test(`fails closed: ${name}`, async () => { const { state, deps } = harness(); change(state); assert.equal((await load(input, deps)).code, code); });
test("recheck freshly authenticates and detects same-version material changes", async () => {
  const { state, deps } = harness(); const { head } = await load(input, deps);
  assert.equal((await recheck(head, deps)).status, "ready"); assert.equal(state.calls, 2);
  state.row.metadata.format = "script"; assert.equal((await recheck(head, deps)).code, "stale");
});
test("recheck rejects copied handles and switched users", async () => {
  const { state, deps } = harness(); const { head } = await load(input, deps);
  assert.equal((await recheck({ ...head }, deps)).code, "invalid_input");
  state.principal.id = id; assert.equal((await recheck(head, deps)).code, "unavailable");
});
test("read failures do not leak exceptions", async () => {
  const { deps } = harness(); const auth = deps.authenticate;
  deps.authenticate = async () => ({ ...(await auth()), readHead: async () => { throw new Error("private details"); } });
  assert.deepEqual(await load(input, deps), { status: "stopped", code: "read_failed" });
});
