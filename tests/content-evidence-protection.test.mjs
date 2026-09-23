import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as zod from "zod";
import { isContentEvidence } from "../lib/content-evidence-protection.ts";

const recordId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }

async function routeHarness(routeName) {
  const source = await readFile(new URL(`../app/api/v1/${routeName}/route.ts`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  let writes = 0;
  const current = { id: recordId, title: "근거", record_type: "content_package", status: "draft", version: 1,
    metadata: { packageKind: "claim_evidence" } };
  const database = { from() {
    const query = { select() { return query; }, eq() { return query; }, is() { return query; },
      async maybeSingle() { return { data: current, error: null }; },
      insert() { writes += 1; return query; }, update() { writes += 1; return query; } };
    return query;
  } };
  const actor = routeName === "agent-records"
    ? { type: "agent", id: recordId, ownerId: recordId }
    : { type: "user", id: recordId, role: "admin", supabase: database };
  const modules = {
    "next/server": { NextResponse: Response }, zod,
    "@/lib/http": { ApiError, parseJson: request => request.json(), apiErrorResponse: error => Response.json({ error: { code: error.code } }, { status: error.status ?? 500 }) },
    "@/lib/server/auth": { authenticateRequest: async () => actor, requireAgentScope: () => {} },
    "@/lib/record-types": { RECORD_TYPES: ["content_package"] },
    "@/lib/record-validation": { recordCreateSchema: { parse: value => value }, recordUpdateSchema: { parse: value => value } },
    "@/lib/content-pipeline": { protectedPipelineChange: () => false },
    "@/lib/development-requests": { isDevelopmentRequest: () => false },
    "@/lib/content-evidence-protection": { isContentEvidence },
    "@/lib/server/organization": { assertOrganization: async () => {} },
    "@/lib/supabase/server": { createServiceSupabase: () => database },
  };
  const loaded = { exports: {} };
  runInNewContext(`(function(require,module,exports){${code}\n})`, { Response, Request, URL,
    require: name => { assert.ok(name in modules, name); return modules[name]; },
  })(name => modules[name], loaded, loaded.exports);
  const body = { recordType: "content_package", metadata: { packageKind: "claim_evidence" }, id: recordId,
    expectedVersion: 1, organizationId };
  const request = method => new Request(`https://example.com/api/v1/${routeName}?id=${recordId}&recordId=${recordId}&organizationId=${organizationId}&confirm=true`, {
    method, headers: { "content-type": "application/json" }, ...method === "DELETE" ? {} : { body: JSON.stringify(body) },
  });
  return { route: loaded.exports, request, writes: () => writes };
}

test("only the three evidence subtypes require the validated evidence endpoints", () => {
  for (const packageKind of ["copy_decision_evidence", "publication_copy_observation", "claim_evidence"])
    assert.equal(isContentEvidence("content_package", { packageKind }), true);
  assert.equal(isContentEvidence("content_package", { packageKind: "title_package" }), false);
  assert.equal(isContentEvidence("content_topic", { packageKind: "claim_evidence" }), false);
  assert.equal(isContentEvidence("content_package", null), false);
});

test("human and agent record routes both close create, update and archive bypasses", async () => {
  for (const route of ["records", "agent-records"]) {
    const source = await readFile(new URL(`../app/api/v1/${route}/route.ts`, import.meta.url), "utf8");
    assert.match(source, /isContentEvidence\(input\.recordType, input\.metadata\)/);
    assert.match(source, /isContentEvidence\(current\.record_type, current\.metadata\) \|\| isContentEvidence\(input\.recordType \?\? current\.record_type, input\.metadata\)/);
    assert.match(source, /if \(isContentEvidence\(current\.record_type, current\.metadata\)\)/);
    assert.match(source, /EVIDENCE_API_REQUIRED/);
    assert.match(source, /EVIDENCE_APPEND_ONLY/);
  }
});

test("both record APIs stop evidence forgery, edits and archive before any write", async () => {
  for (const routeName of ["records", "agent-records"]) {
    const h = await routeHarness(routeName);
    for (const [method, status] of [["POST", 403], ["PATCH", 409], ["DELETE", 409]]) {
      const response = await h.route[method](h.request(method));
      assert.equal(response.status, status, `${routeName} ${method}`);
      assert.equal(h.writes(), 0, `${routeName} ${method} must not write`);
    }
  }
});
