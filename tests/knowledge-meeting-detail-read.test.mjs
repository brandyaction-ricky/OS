import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as zod from "zod";
import { projectMeetings } from "../lib/knowledge/meetings.ts";

const id = "00000000-0000-4000-8000-000000000001";
const row = { id, title: "QA 회의", description: "기존 회의록", status: "planned", version: 1,
  owner_id: "owner", created_by: "owner", created_at: "2026-10-11T00:00:00Z", updated_at: "2026-10-11T00:00:00Z", starts_at: null,
  metadata: { workspace: "knowledge", visibility: "attendees", agenda: "안건", items: [] } };
class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }

function endpoint({ actorId = "owner", authenticated = true } = {}) {
  const calls = [];
  const db = { from(table) {
    calls.push(table);
    const query = { select() { return query; }, eq() { return query; }, is() { return query; }, in() { return query; }, contains() { return query; },
      maybeSingle: async () => ({ data: row, error: null }),
      then(resolve) { resolve({ data: table === "os_meeting_attendees" ? [{ meeting_id: id, user_id: "owner" }] : [{ id: "owner", display_name: "QA", role: "member", member_kind: "staff" }], error: null }); } };
    return query;
  } };
  const modules = {
    "next/server": { NextResponse: Response }, zod,
    "@/lib/http": { ApiError, apiErrorResponse: error => Response.json({ error: { code: error.code, message: error.message } }, { status: error.status ?? 500 }) },
    "@/lib/server/auth": { authenticateRequest: async () => { if (!authenticated) throw new ApiError(401, "AUTH_REQUIRED", "로그인 필요"); return { ownerId: actorId, supabase: db }; } },
    "@/lib/supabase/server": { createServiceSupabase: () => db },
    "@/lib/server/knowledge-access": { knowledgeAccessContext: async () => ({ actor: { ownerId: actorId, type: "user", active: true, memberKind: "staff" } }) },
    "@/lib/knowledge/meetings": { projectMeetings },
  };
  const exports = {};
  const source = readFileSync(new URL("../app/api/v1/knowledge/meetings/[id]/route.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, require: name => { assert.ok(name in modules, name); return modules[name]; }, Response });
  return { ...exports, calls };
}

test("meeting detail reads only its record, attendance and visible profiles", async () => {
  const api = endpoint();
  const response = await api.GET(new Request("http://localhost"), { params: Promise.resolve({ id }) });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.meeting.id, id);
  assert.deepEqual(api.calls, ["os_records", "os_meeting_attendees", "os_profiles"]);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("meeting detail fails closed before revealing a private meeting", async () => {
  const api = endpoint({ actorId: "someone-else" });
  const response = await api.GET(new Request("http://localhost"), { params: Promise.resolve({ id }) });
  assert.equal(response.status, 404);
  assert.deepEqual(api.calls, ["os_records", "os_meeting_attendees"]);
  const signedOut = endpoint({ authenticated: false });
  assert.equal((await signedOut.GET(new Request("http://localhost"), { params: Promise.resolve({ id }) })).status, 401);
  assert.deepEqual(signedOut.calls, []);
});
