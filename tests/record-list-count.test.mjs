import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as zod from "zod";

class ApiError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code }); }
}
function route({ denied = false } = {}) {
  const calls = [];
  const rows = [{ id: "synthetic", record_type: "task", title: "Synthetic task" }];
  const query = new Proxy({}, { get: (_, key) => {
    if (key === "then") return resolve => resolve({ data: rows, count: 251, error: null });
    return (...args) => { calls.push([key, ...args]); return query; };
  } });
  const imports = {
    zod,
    "next/server": { NextResponse: Response },
    "@/lib/http": { ApiError, apiErrorResponse: error => Response.json({ error: { code: error.code } }, { status: error.status }) },
    "@/lib/server/auth": { authenticateRequest: async () => {
      if (denied) throw new ApiError(401, "INVALID_SESSION", "Login required");
      return { id: "synthetic-user", supabase: { from: table => { calls.push(["from", table]); return query; } } };
    } },
    "@/lib/record-types": { RECORD_TYPES: ["task", "content_topic", "development_comment", "notification"] },
    "@/lib/team/dates": { recordDateRange: () => null },
  };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("../app/api/v1/records/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, URL, require: name => imports[name] ?? {} });
  return { ...exports, calls };
}

test("record lists retain exact totals by default, while opt-in pages skip the count", async () => {
  for (const noCount of [false, true]) {
    const api = route();
    const response = await api.GET(new Request(`https://example.invalid/api/v1/records?type=task&limit=200&offset=200&status=active&assignee=me${noCount ? "&count=none" : ""}`));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.total, noCount ? null : 251);
    assert.equal(api.calls.find(call => call[0] === "select")[2].count, noCount ? undefined : "exact");
    assert.ok(api.calls.some(call => call[0] === "eq" && call[1] === "assignee_id" && call[2] === "synthetic-user"));
    assert.ok(api.calls.some(call => call[0] === "eq" && call[1] === "status" && call[2] === "active"));
    assert.ok(api.calls.some(call => call[0] === "range" && call[1] === 200 && call[2] === 399));
  }
});

test("count-free reads retain authentication and protected-record restrictions", async () => {
  const denied = route({ denied: true });
  assert.equal((await denied.GET(new Request("https://example.invalid/api/v1/records?count=none&type=task"))).status, 401);
  assert.equal(denied.calls.length, 0);
  const restricted = route();
  assert.equal((await restricted.GET(new Request("https://example.invalid/api/v1/records?count=none&type=development_comment"))).status, 403);
  assert.equal(restricted.calls.length, 0);
});

test("only count-free continuation pages may read up to 1,000 rows", async () => {
  for (const [query, end] of [["count=none&limit=1000", 999], ["limit=1000", 199], ["count=none&limit=5000", 999]]) {
    const api = route();
    assert.equal((await api.GET(new Request(`https://example.invalid/api/v1/records?type=task&${query}`))).status, 200);
    assert.ok(api.calls.some(call => call[0] === "range" && call[1] === 0 && call[2] === end), query);
  }
});
