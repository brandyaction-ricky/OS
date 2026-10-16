import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as zod from "zod";

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const memberId = "00000000-0000-4000-8000-000000000002";
function harness({ role = "admin", anonymous = false, targetRole = "member", active = true, finance = false, readError = null, writeError = null, race = false } = {}) {
  const writes = [];
  const target = { id: memberId, role: targetRole, is_active: active, finance_access: finance };
  const service = { from(table) {
    assert.equal(table, "os_profiles");
    let payload;
    const filters = {}, excluded = {};
    const q = {
      select() { return q; },
      eq(k, v) { filters[k] = v; return q; },
      neq(k, v) { excluded[k] = v; return q; },
      update(value) { payload = value; return q; },
      async maybeSingle() {
        if (!payload) return { data: target, error: readError };
        writes.push({ payload, filters, excluded });
        return { data: race || writeError ? null : { id: memberId, finance_access: payload.finance_access }, error: writeError };
      },
    };
    return q;
  } };
  const imports = {
    "next/server": { NextResponse: Response }, zod,
    "@/lib/http": { ApiError, parseJson: r => r.json(), apiErrorResponse: e => Response.json({ code: e.code }, { status: e.status || 500 }) },
    "@/lib/server/auth": { authenticateRequest: async () => { if (anonymous) throw new ApiError(401, "UNAUTHORIZED", ""); return { role }; } },
    "@/lib/supabase/server": { createServiceSupabase: () => service },
  };
  const mod = { exports: {} };
  const source = fs.readFileSync(new URL("../app/api/v1/members/finance-access/route.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module: mod, exports: mod.exports, require: id => { assert.ok(id in imports, id); return imports[id]; }, Request, Response, Date });
  return { ...mod.exports, writes };
}
const request = (extra = {}) => new Request("https://example.test/api/v1/members/finance-access", {
  method: "PATCH", body: JSON.stringify({ memberId, financeAccess: true, expectedFinanceAccess: false, ...extra }),
});

test("sensitive access rejects anonymous and non-admin actors before any profile write", async () => {
  for (const [options, status] of [[{ anonymous: true }, 401], [{ role: "member" }, 403], [{ role: "lead" }, 403]]) {
    const api = harness(options);
    assert.equal((await api.PATCH(request())).status, status);
    assert.equal(api.writes.length, 0);
  }
});
test("explicit admin grant and revoke update only access, with account and concurrency guards", async () => {
  for (const finance of [false, true]) {
    const api = harness({ finance });
    const response = await api.PATCH(request({ financeAccess: !finance, expectedFinanceAccess: finance }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { memberId, financeAccess: !finance });
    const write = api.writes[0];
    assert.deepEqual(Object.keys(write.payload).sort(), ["finance_access", "updated_at"]);
    assert.deepEqual(write.filters, { id: memberId, finance_access: finance, is_active: true });
    assert.deepEqual(write.excluded, { role: "admin" });
  }
});
test("inactive and administrator targets cannot be changed by this narrow endpoint", async () => {
  for (const [options, status] of [[{ active: false }, 404], [{ targetRole: "admin" }, 400]]) {
    const api = harness(options);
    assert.equal((await api.PATCH(request())).status, status);
    assert.equal(api.writes.length, 0);
  }
});
test("stale access and a race after the read return conflict instead of reporting success", async () => {
  const stale = harness({ finance: true });
  assert.equal((await stale.PATCH(request())).status, 409);
  assert.equal(stale.writes.length, 0);
  assert.equal((await harness({ race: true }).PATCH(request())).status, 409);
});
test("unknown fields and malformed account or permission values never reach writes", async () => {
  for (const extra of [{ role: "admin" }, { memberId: "directory:example" }, { financeAccess: "true" }, { expectedFinanceAccess: undefined }]) {
    const api = harness();
    assert.equal((await api.PATCH(request(extra))).status, 400);
    assert.equal(api.writes.length, 0);
  }
});
test("database failures return bounded errors and never expose raw database messages", async () => {
  for (const options of [{ readError: { message: "private database details" } }, { writeError: { message: "private database details" } }]) {
    const response = await harness(options).PATCH(request());
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes("private database details"));
  }
});
