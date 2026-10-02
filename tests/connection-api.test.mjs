import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as zod from "zod";
const code = ts.transpileModule(await readFile(new URL("../app/api/v1/connections/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const ownerA = "00000000-0000-4000-8000-000000000001", ownerB = "00000000-0000-4000-8000-000000000002";
function setup(options = {}) {
  const events = [];
  const db = { from(table) {
    let mutation = "read", values, filters = [], head = false;
    const query = { select(_fields, input) { head = input?.head ?? false; return query; }, limit() { return query; },
      eq(key, value) { filters.push([key, value]); return query; }, gte() { return query; }, in() { return query; },
      insert(input) { mutation = "insert"; values = input; return query; }, update(input) { mutation = "update"; values = input; return query; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        events.push({ table, mutation, values, filters });
        if (mutation !== "read") return { data: options.conflict ? [] : [{ service: values.service }], error: options.saveFailure ? { code: "ERROR" } : null };
        if (table === "os_profiles") return { data: options.inactive ? [] : [{ id: ownerA }, { id: ownerB }], error: null };
        return { data: [], count: head ? options.recentCount ?? 0 : null, error: options.historyUnavailable ? { code: "42P01" } : null };
      }).then(resolve, reject); },
    }; return query;
  } };
  const modules = {
    "next/server": { NextResponse: Response }, zod,
    "@/lib/http": { ApiError, apiErrorResponse: error => Response.json({ error: { code: error.code } }, { status: error.status || 500 }), parseJson: request => request.json() },
    "@/lib/server/auth": { authenticateRequest: async request => { if (!request.headers.has("authorization")) throw new ApiError(401, "AUTH_REQUIRED"); if (request.headers.get("authorization").includes("bos_pat_")) throw new ApiError(403, "AGENT_READ_ONLY"); return { id: ownerA, role: options.role ?? "admin" }; } },
    "@/lib/supabase/server": { createServiceSupabase: () => db },
    "@/lib/server/connection-checks": { connectionConfiguration: () => ({ database: options.configured !== false }), readConnectionChecks: async () => [{ id: "database", status: "error", failures24h: 1 }], probeConnection: async () => { events.push({ probe: true }); if (options.probeFailure) throw Error("upstream-secret-body"); } },
  };
  const compiled = { exports: {} }; runInNewContext(code, { module: compiled, exports: compiled.exports, Date, require: name => { assert.ok(name in modules, name); return modules[name]; } });
  const call = (method, body, authorization = "Bearer test-human") => compiled.exports[method](new Request("http://localhost/api/v1/connections", { method, headers: authorization ? { authorization, "content-type": "application/json" } : {}, ...(body ? { body: JSON.stringify(body) } : {}) }));
  return { call, events };
}
test("no token, non-admin and AI keys cannot read or mutate service evidence", async () => {
  for (const method of ["GET", "POST", "PATCH"]) {
    for (const [options, token, expected] of [[{}, null, 401], [{ role: "member" }, "Bearer member", 403], [{}, "Bearer bos_pat_test", 403]]) {
      const env = setup(options); assert.equal((await env.call(method, method === "GET" ? undefined : { service: "database" }, token)).status, expected); assert.equal(env.events.length, 0);
    }
  }
});
test("invalid or unconfigured services and unavailable history never call providers", async () => {
  for (const [options, service, status] of [[{}, "https://example.test", 400], [{ configured: false }, "database", 409], [{ historyUnavailable: true }, "database", 503], [{ recentCount: 3 }, "database", 429]]) {
    const env = setup(options); assert.equal((await env.call("POST", { service })).status, status); assert.ok(!env.events.some(event => event.probe));
  }
});
test("failed probes persist only a boolean and keep historical failures in the response", async () => {
  const env = setup({ probeFailure: true }); const response = await env.call("POST", { service: "database" });
  const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.ok, false); assert.equal(body.checks[0].failures24h, 1);
  const saved = env.events.find(event => event.mutation === "insert"); assert.deepEqual(JSON.parse(JSON.stringify(saved.values)), { service: "database", ok: false });
  assert.doesNotMatch(JSON.stringify(body), /upstream-secret/);
});
test("success cannot erase a recent failure, and save failures never claim completed tests", async () => {
  const env = setup(); const body = await (await env.call("POST", { service: "database" })).json();
  assert.equal(body.ok, true); assert.equal(body.checks[0].status, "error");
  assert.equal((await setup({ saveFailure: true }).call("POST", { service: "database" })).status, 503);
});
test("owner changes reject duplicate/inactive owners and lost updates", async () => {
  const input = { service: "database", primaryOwner: ownerA, backupOwner: ownerB, expectedVersion: 2 };
  assert.equal((await setup().call("PATCH", { ...input, backupOwner: ownerA })).status, 400);
  assert.equal((await setup({ inactive: true }).call("PATCH", input)).status, 400);
  assert.equal((await setup({ conflict: true }).call("PATCH", input)).status, 409);
  const env = setup(); assert.equal((await env.call("PATCH", input)).status, 200);
  const update = env.events.find(event => event.mutation === "update"); assert.equal(update.values.version, 3); assert.ok(update.filters.some(([key, value]) => key === "version" && value === 2));
});
