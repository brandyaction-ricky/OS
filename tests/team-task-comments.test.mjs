import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";

class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const taskId = "11111111-1111-4111-8111-111111111111";

function route({ authenticated = true, visible = true, enabled = true } = {}) {
  const calls = [];
  const taskQuery = { select() { return this; }, eq() { return this; }, is() { return this; }, async maybeSingle() { return { data: visible ? { id: taskId, title: "검증 업무", version: 3 } : null, error: null }; } };
  const eventQuery = { select() { return this; }, eq() { return this; }, order() { return this; }, async limit() { return { data: [], error: null }; } };
  const actor = { id: "22222222-2222-4222-8222-222222222222", type: "user", supabase: { from: table => table === "os_records" ? taskQuery : eventQuery } };
  const service = { from(table) { assert.equal(table, "os_record_events"); return { async insert(row) { calls.push(row); return { error: null }; } }; } };
  const modules = {
    "next/server": { NextResponse: Response }, zod: { z },
    "@/lib/http": { ApiError, apiErrorResponse: error => Response.json({ error: { code: error.code } }, { status: error.status ?? 500 }), parseJson: request => request.json() },
    "@/lib/server/auth": { authenticateRequest: async () => { if (!authenticated) throw new ApiError(401, "AUTH_REQUIRED", "로그인 필요"); return actor; } },
    "@/lib/supabase/server": { createServiceSupabase: () => service },
    "@/lib/team/gate": { teamV1Enabled: () => enabled },
  };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("../app/api/v1/team/task-comments/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, require: name => { assert.ok(name in modules, name); return modules[name]; }, Response, URL });
  return { ...exports, calls };
}

test("task comments require a visible task before the service role inserts an event", async () => {
  const hidden = route({ visible: false });
  const request = new Request("http://localhost/api/v1/team/task-comments", { method: "POST", body: JSON.stringify({ id: taskId, text: "확인했습니다" }) });
  assert.equal((await hidden.POST(request)).status, 404);
  assert.equal(hidden.calls.length, 0);
  const signedOut = route({ authenticated: false });
  assert.equal((await signedOut.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ id: taskId, text: "확인했습니다" }) }))).status, 401);
  assert.equal(signedOut.calls.length, 0);
});

test("task comments append an event without creating a restorable record snapshot", async () => {
  const api = route();
  const response = await api.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ id: taskId, text: "  확인했습니다  " }) }));
  assert.equal(response.status, 200);
  assert.equal(api.calls.length, 1);
  assert.equal(api.calls[0].event_type, "comment");
  assert.equal(api.calls[0].note, "확인했습니다");
  assert.deepEqual(JSON.parse(JSON.stringify(api.calls[0].snapshot)), {});
});
