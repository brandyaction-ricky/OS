import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { projectMeetings } from "../lib/knowledge/meetings.ts";

class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const meeting = (id, visibility, owner = "owner") => ({
  id, title: id, status: "planned", version: 1, owner_id: owner, created_by: owner,
  created_at: "2026-10-11T00:00:00Z", updated_at: "2026-10-11T00:00:00Z", starts_at: null,
  metadata: { workspace: "knowledge", visibility, agenda: "", items: [] },
});

function endpoint({ actorId = "owner", authenticated = true, records = [meeting("own", "attendees"), meeting("team", "team", "other"), meeting("private", "attendees", "other")] } = {}) {
  const calls = [];
  const attendance = [{ meeting_id: "own", user_id: "owner" }, { meeting_id: "private", user_id: "other" }];
  const db = { from(table) {
    calls.push(table);
    let ids = [];
    const query = {
      select() { return query; }, eq() { return query; }, is() { return query; }, order() { return query; },
      in(_column, value) { ids = value; return query; },
      range(start, end) {
        const data = table === "os_records" ? records : table === "os_meeting_attendees" ? attendance.filter(row => ids.includes(row.meeting_id)) : [{ id: "owner", display_name: "Owner" }];
        return Promise.resolve({ data: data.slice(start, end + 1), error: null });
      },
      then(resolve) { resolve({ data: [{ id: "owner", display_name: "Owner" }], error: null }); },
    };
    return query;
  } };
  const modules = {
    "next/server": { NextResponse: Response },
    "@/lib/http": { ApiError, apiErrorResponse: error => Response.json({ error: { code: error.code } }, { status: error.status ?? 500 }) },
    "@/lib/server/auth": { authenticateRequest: async () => { if (!authenticated) throw new ApiError(401, "AUTH_REQUIRED", "로그인 필요"); return { ownerId: actorId, supabase: db }; } },
    "@/lib/supabase/server": { createServiceSupabase: () => db },
    "@/lib/server/knowledge-access": { knowledgeAccessContext: async () => ({ actor: { ownerId: actorId, type: "user", active: true, memberKind: "staff" } }) },
    "@/lib/knowledge/meetings": { projectMeetings },
  };
  const exports = {};
  const source = readFileSync(new URL("../app/api/v1/knowledge/meetings/route.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, require: name => { assert.ok(name in modules, name); return modules[name]; }, Response, Set, Map });
  return { ...exports, calls };
}

test("meeting list reads only meetings, attendance and visible names", async () => {
  const api = endpoint();
  const response = await api.GET(new Request("http://localhost"));
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.deepEqual(body.meetings.map(row => row.id), ["own", "team"]);
  assert.deepEqual(api.calls, ["os_records", "os_meeting_attendees", "os_profiles"]);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("meeting list paginates and rejects anonymous users before database access", async () => {
  const rows = Array.from({ length: 501 }, (_, index) => meeting(String(index).padStart(3, "0"), "team"));
  const api = endpoint({ records: rows });
  const response = await api.GET(new Request("http://localhost"));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).meetings.length, 501);
  assert.equal(api.calls.filter(table => table === "os_records").length, 2);
  const anonymous = endpoint({ authenticated: false });
  assert.equal((await anonymous.GET(new Request("http://localhost"))).status, 401);
  assert.deepEqual(anonymous.calls, []);
});
