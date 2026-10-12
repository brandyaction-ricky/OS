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

function endpoint({ actorId = "owner", authenticated = true, memberKind = "staff", records = [meeting("own", "attendees"), meeting("team", "team", "other"), meeting("private", "attendees", "other")], attendance = [{ meeting_id: "own", user_id: "owner" }, { meeting_id: "private", user_id: "other" }], profiles = [{ id: "owner", display_name: "Owner" }] } = {}) {
  const calls = [], selections = [], profileBatches = [];
  const db = { from(table) {
    calls.push(table);
    let ids = [];
    const query = {
      select(columns) { selections.push({ table, columns }); return query; }, eq() { return query; }, is() { return query; }, order() { return query; },
      in(_column, value) { ids = value; if (table === "os_profiles") profileBatches.push(value); return query; },
      range(start, end) {
        const data = table === "os_records" ? records.map(({ metadata, ...row }) => ({ ...row, workspace: metadata?.workspace ?? null, visibility: metadata?.visibility ?? null })) : table === "os_meeting_attendees" ? attendance.filter(row => ids.includes(row.meeting_id)) : profiles.filter(row => ids.includes(row.id));
        return Promise.resolve({ data: data.slice(start, end + 1), error: null });
      },
      then(resolve) { resolve({ data: profiles.filter(row => ids.includes(row.id)), error: null }); },
    };
    return query;
  } };
  const modules = {
    "next/server": { NextResponse: Response },
    "@/lib/http": { ApiError, apiErrorResponse: error => Response.json({ error: { code: error.code } }, { status: error.status ?? 500 }) },
    "@/lib/server/auth": { authenticateRequest: async () => { if (!authenticated) throw new ApiError(401, "AUTH_REQUIRED", "로그인 필요"); return { ownerId: actorId, supabase: db }; } },
    "@/lib/supabase/server": { createServiceSupabase: () => db },
    "@/lib/server/knowledge-access": { knowledgeAccessContext: async () => ({ actor: { ownerId: actorId, type: "user", active: true, memberKind } }) },
    "@/lib/knowledge/meetings": { projectMeetings },
  };
  const exports = {};
  const source = readFileSync(new URL("../app/api/v1/knowledge/meetings/route.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, require: name => { assert.ok(name in modules, name); return modules[name]; }, Response, Set, Map });
  return { ...exports, calls, selections, profileBatches };
}

test("meeting list reads only meetings, attendance and visible names", async () => {
  const api = endpoint();
  const response = await api.GET(new Request("http://localhost"));
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.deepEqual(body.meetings.map(row => row.id), ["own", "team"]);
  assert.deepEqual(api.calls, ["os_records", "os_meeting_attendees", "os_profiles"]);
  const recordFields = api.selections.find(query => query.table === "os_records").columns.split(",");
  assert.ok(recordFields.includes("workspace:metadata->>workspace"));
  assert.ok(recordFields.includes("visibility:metadata->>visibility"));
  assert.ok(!recordFields.includes("metadata"), "list reads must omit transcripts, summaries and decision bodies");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("minimal metadata keeps legacy fallback and private attendee permissions", async () => {
  const legacy = { ...meeting("legacy", undefined, "legacy-owner"), metadata: { transcript: "not part of the list", items: [{ text: "not part of the list" }] } };
  const records = [legacy, meeting("team", "team", "other"), meeting("private", "attendees", "other")];
  const staff = endpoint({ records });
  const staffBody = await (await staff.GET(new Request("http://localhost"))).json();
  assert.deepEqual(staffBody.meetings.map(row => row.id), ["legacy", "team"]);
  assert.deepEqual(staffBody.meetings[0].attendees, ["legacy-owner"]);
  assert.equal(staffBody.meetings[0].visibility, "team");
  assert.ok(!JSON.stringify(staffBody).includes("not part of the list"));
  const partner = endpoint({ records, memberKind: "partner", actorId: "legacy-owner" });
  const partnerBody = await (await partner.GET(new Request("http://localhost"))).json();
  assert.deepEqual(partnerBody.meetings.map(row => row.id), ["legacy"]);
});

test("attendee names are read in bounded batches after visible meetings are selected", async () => {
  const attendance = Array.from({ length: 401 }, (_, index) => ({ meeting_id: "team", user_id: `synthetic-${index}` }));
  const profiles = attendance.map(row => ({ id: row.user_id, display_name: row.user_id }));
  const api = endpoint({ records: [meeting("team", "team")], attendance, profiles });
  const body = await (await api.GET(new Request("http://localhost"))).json();
  assert.equal(body.people.length, 401);
  assert.deepEqual(api.profileBatches.map(ids => ids.length), [200, 200, 1]);
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
