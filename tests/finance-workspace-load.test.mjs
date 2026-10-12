import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as zod from "zod";
import * as domain from "../lib/finance/domain.mjs";
import * as adapter from "../lib/finance/ledger-adapter.mjs";

class ApiError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code }); }
}
class ApiRequestError extends Error {
  constructor(message, code, status) { super(message); Object.assign(this, { status, code }); }
}
function load(file, imports = {}) {
  const exports = {};
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, {
    exports, Buffer, Response, URL, structuredClone,
    console: { error() {} },
    require(name) {
      if (name === "zod") return zod;
      if (name === "@/lib/http") return { ApiError, apiErrorResponse: error => Response.json({ error: { code: error.code, message: error.message } }, { status: error.status ?? 500 }) };
      assert.ok(name in imports, name);
      return imports[name];
    },
  });
  return exports;
}
const schema = load("lib/finance/schema.ts");
const resources = schema.READ_RESOURCES.filter(resource => resource !== "events");
const emptyLedger = () => Object.fromEntries(resources.map(resource => [resource, []]));
const server = load("lib/server/finance.ts", {
  "./auth": {}, "@/lib/finance/schema": schema, "@/lib/finance/domain.mjs": domain,
});
function actorFor({ rows = {}, fail = "" } = {}) {
  const calls = [];
  let active = 0, peak = 0;
  const actor = { supabase: { from(table) {
    const resource = table.replace(/^os_fin_/, "");
    return {
      select() { return this; }, order() { return this; },
      async range(from, to) {
        calls.push({ resource, from, to });
        active += 1; peak = Math.max(peak, active);
        await new Promise(resolve => setImmediate(resolve));
        active -= 1;
        return resource === fail ? { error: { message: "PRIVATE_DATABASE_DETAIL" }, data: null }
          : { data: (rows[resource] ?? []).slice(from, to + 1), error: null };
      },
    };
  } } };
  return { actor, calls, get peak() { return peak; } };
}
function route(actor, denied = false) {
  let authentications = 0;
  const api = load("app/api/v1/finance/[...path]/route.ts", {
    "next/server": { NextResponse: Response },
    "@/lib/server/finance": { ...server, financeActor: async () => { authentications += 1; if (denied) throw new ApiError(403, "FINANCE_FORBIDDEN", "권한 없음"); return actor; } },
    "@/lib/server/finance-receipts": {}, "@/lib/server/finance-refunds": {}, "@/lib/server/finance-imports": {},
    "@/lib/finance/schema": schema, "@/lib/finance/domain.mjs": domain,
  });
  return { ...api, get authentications() { return authentications; } };
}
const context = { params: Promise.resolve({ path: ["workspace"] }) };
const request = query => new Request(`https://example.invalid/api/v1/finance/workspace?${query}`);

test("finance batch authenticates once, bounds DB concurrency and includes paged rows without provider secrets", async () => {
  const fixture = actorFor({ rows: { stores: Array.from({ length: 1001 }, (_, i) => ({ id: `synthetic-${i}`, version: 1, raw: "PRIVATE", secret_env: "PRIVATE" })) } });
  const api = route(fixture.actor);
  const response = await api.GET(request("batch=1"), context);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(api.authentications, 1);
  assert.equal(fixture.peak, 4);
  assert.equal(fixture.calls.length, resources.length + 1);
  assert.equal(body.data.stores.length, 1001);
  assert.equal(body.data.stores[0].raw, undefined);
  assert.equal(body.data.stores[0].secret_env, undefined);
  assert.deepEqual(Object.keys(body.data).sort(), [...resources].sort());
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("finance workspace retains single-resource paging and rejects unauthorized batch reads before database access", async () => {
  const fixture = actorFor({ rows: { payments: Array.from({ length: 1001 }, (_, i) => ({ id: `synthetic-${i}`, version: 1 })) } });
  const api = route(fixture.actor);
  const first = await (await api.GET(request("resource=payments"), context)).json();
  assert.equal(first.rows.length, 1000); assert.equal(first.nextOffset, 1000);
  const second = await (await api.GET(request("resource=payments&offset=1000"), context)).json();
  assert.equal(second.rows.length, 1); assert.equal(second.nextOffset, null);
  const denied = actorFor();
  assert.equal((await route(denied.actor, true).GET(request("batch=1"), context)).status, 403);
  assert.equal(denied.calls.length, 0);
});

test("finance batch failure is atomic and stops queueing more resources", async () => {
  const fixture = actorFor({ fail: resources[0] });
  const response = await route(fixture.actor).GET(request("batch=1"), context);
  assert.equal(response.status, 400);
  const body = await response.text();
  assert.doesNotMatch(body, /PRIVATE_DATABASE_DETAIL|"data"/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.calls.length, 4);
});

test("large finance batches stop after the overflowing page instead of finishing the ledger", async () => {
  const fixture = actorFor({ rows: { [resources[0]]: Array.from({ length: 1001 }, (_, i) => ({ id: `synthetic-${i}`, description: "가".repeat(1200) })) } });
  const response = await route(fixture.actor).GET(request("batch=1"), context);
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "FINANCE_WORKSPACE_PAGED");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.calls.length, 4, "only the already-started four reads may finish");
  assert.ok(fixture.calls.every(call => call.from === 0), "the overflowing resource never reads its next page");
});

test("finance byte budgets include UTF-8, every resource and inter-page commas exactly", async () => {
  const rows = {
    [resources[0]]: Array.from({ length: 1001 }, (_, i) => ({ id: `synthetic-${i}`, description: "가나다" })),
    [resources[1]]: [{ id: "other-resource", description: "메모" }],
  };
  const expected = { ...emptyLedger(), ...rows };
  const bytes = Buffer.byteLength(JSON.stringify(expected), "utf8");
  const result = await server.readLedger(actorFor({ rows }).actor, { maxBytes: bytes });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), expected);
  await assert.rejects(server.readLedger(actorFor({ rows }).actor, { maxBytes: bytes - 1 }), error => error.code === "FINANCE_WORKSPACE_PAGED");
});

test("save validation still reads complete ledgers larger than the batch transport budget", async () => {
  const fixture = actorFor({ rows: { [resources[0]]: Array.from({ length: 1001 }, (_, i) => ({ id: `synthetic-${i}`, description: "가".repeat(1200) })) } });
  const commits = [];
  fixture.actor.supabase.rpc = async (name, args) => { commits.push({ name, args }); return { data: [], error: null }; };
  const response = await route(fixture.actor).POST(new Request("https://example.invalid/api/v1/finance/batch", {
    method: "POST",
    body: JSON.stringify({ changes: [{ resource: "settings", row: { id: "00000000-0000-4000-8000-000000000001", version: 0, key: "net_include_research", value: true } }] }),
  }), { params: Promise.resolve({ path: ["batch"] }) });
  assert.equal(response.status, 200);
  assert.equal(fixture.calls.length, resources.length + 1);
  assert.ok(fixture.calls.some(call => call.resource === resources[0] && call.from === 1000));
  assert.equal(commits[0].name, "os_fin_commit");
});

function client(apiRequest) {
  return load("lib/finance/client.ts", {
    "@/lib/api-client": { apiRequest, ApiRequestError }, "./schema": schema, "./ledger-adapter.mjs": adapter,
  });
}
test("finance client renders from one batch request and only falls back for the explicit response-size signal", async () => {
  const calls = [];
  const connection = await client(async path => { calls.push(path); return { data: emptyLedger() }; })
    .connectFinance(() => "synthetic-token", new AbortController().signal);
  assert.deepEqual(calls, ["/api/v1/finance/workspace?batch=1"]);
  assert.ok(connection.data);
  const fallbackCalls = [];
  await client(async path => {
    fallbackCalls.push(path);
    if (path.endsWith("batch=1")) throw new ApiRequestError("split", "FINANCE_WORKSPACE_PAGED", 413);
    return { rows: [], nextOffset: null };
  }).connectFinance(() => "synthetic-token", new AbortController().signal);
  assert.equal(fallbackCalls.length, resources.length + 1);
  let forbiddenCalls = 0;
  await assert.rejects(client(async () => { forbiddenCalls += 1; throw new ApiRequestError("denied", "FINANCE_FORBIDDEN", 403); })
    .connectFinance(() => "synthetic-token", new AbortController().signal), error => error.code === "FINANCE_FORBIDDEN");
  assert.equal(forbiddenCalls, 1);
});
