import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { projectMeetings } from "../lib/knowledge/meetings.ts";

class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const actor = { ownerId: "reader", type: "user", role: "member", memberKind: "staff", active: true, allowedStatuses: [] };

function route({ meetings = [], decisions = [], attendees = [], failure = "", authenticated = true, enabled = true } = {}) {
  const calls = [];
  const db = { from(table) {
    let kind = "", start = 0, end = 499;
    const builder = new Proxy({}, { get: (_, key) => {
      if (key === "then") return resolve => {
        calls.push({ table, kind, start, end });
        const source = table === "os_meeting_attendees" ? attendees : kind === "meeting" ? meetings : decisions;
        resolve({ data: table === failure ? null : source.slice(start, end + 1), error: table === failure ? { message: "private SQL details" } : null });
      };
      return (...args) => { if (key === "eq" && args[0] === "record_type") kind = args[1]; if (key === "range") [start,end] = args; return builder; };
    }});
    return builder;
  }};
  const modules = {
    "next/server": { NextResponse: Response },
    "@/lib/http": { ApiError, apiErrorResponse: error => Response.json({ error: { code:error.code, message:error.message } }, { status:error.status ?? 500 }) },
    "@/lib/server/auth": { authenticateRequest: async () => { if (!authenticated) throw new ApiError(401,"AUTH_REQUIRED","로그인 필요"); return { ownerId:"reader", supabase:db }; } },
    "@/lib/server/knowledge-access": { knowledgeAccessContext: async () => ({ actor }) },
    "@/lib/knowledge/meetings": { projectMeetings },
    "@/lib/team/gate": { teamV1Enabled: () => enabled },
  };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("../app/api/v1/team/meetings/route.ts", import.meta.url), "utf8"), { compilerOptions: { module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, require:name => { assert.ok(name in modules,name); return modules[name]; }, Response });
  return { ...exports, calls };
}

test("team meeting read returns only the actor's visible meetings, without a document inventory", async () => {
  const base = { description:"Synthetic notes", status:"done", version:1, owner_id:"author", created_by:"author", updated_at:"2026-10-10T00:00:00Z", starts_at:"2026-10-09T00:00:00Z" };
  const publicMeeting = { ...base, id:"public", title:"Synthetic team meeting", metadata:{ workspace:"knowledge", visibility:"team", agenda:"", items:[] } };
  const privateMeeting = { ...base, id:"private", title:"Synthetic private meeting", metadata:{ workspace:"knowledge", visibility:"attendees", agenda:"", items:[] } };
  const api = route({ meetings:[publicMeeting,privateMeeting] });
  const response = await api.GET(new Request("http://localhost/api/v1/team/meetings"));
  const body = await response.json();
  assert.equal(response.status,200);
  assert.deepEqual(body.meetings.map(meeting=>meeting.id),["public"]);
  assert.deepEqual(new Set(api.calls.map(call=>call.table)),new Set(["os_records","os_meeting_attendees"]));
  assert.equal(response.headers.get("cache-control"),"private, no-store");
});

test("team meeting read authenticates first and hides database error detail", async () => {
  const signedOut = route({ authenticated:false });
  assert.equal((await signedOut.GET(new Request("http://localhost"))).status,401);
  assert.deepEqual(signedOut.calls,[]);
  const failed = route({ failure:"os_records" });
  const response = await failed.GET(new Request("http://localhost"));
  assert.equal(response.status,503);
  assert.doesNotMatch(await response.text(),/private SQL details/);
});

test("team meeting read remains unavailable without the preview flag", async () => {
  const disabled = route({ enabled: false });
  const response = await disabled.GET(new Request("http://localhost"));
  assert.equal(response.status, 404);
  assert.deepEqual(disabled.calls, []);
});
