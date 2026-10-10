import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as zod from "zod";

const docId = "00000000-0000-4000-8000-000000000010";
const keyId = "00000000-0000-4000-8000-000000000020";
const ownerId = "00000000-0000-4000-8000-000000000030";

async function fixture(document = { id: docId, owner_id: ownerId, status: "draft", meeting_record_id: null }) {
  const calls = [];
  const service = {
    from(table) {
      assert.equal(table, "os_documents");
      return { select() { return this; }, eq() { return this; },
        async maybeSingle() { return { data: document, error: null }; } };
    },
  };
  class ApiError extends Error {
    constructor(status, code, message) { super(message); this.status = status; this.code = code; }
  }
  const http = {
    ApiError,
    apiErrorResponse: error => Response.json({ error: { code: error.code ?? "UNKNOWN" } }, { status: error.status ?? 500 }),
    parseJson: request => request.json(),
  };
  const actor = { type: "user", id: ownerId, ownerId, role: "admin",
    supabase: { async rpc(name, args) { calls.push({ name, args }); return { data: 1, error: null }; } } };
  const source = await readFile(new URL("../app/api/v1/agent-document-read-grants/route.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiled = { exports: {} };
  const modules = {
    "next/server": { NextResponse: Response }, zod,
    "@/lib/http": http,
    "@/lib/server/auth": { authenticateRequest: async () => actor },
    "@/lib/supabase/server": { createServiceSupabase: () => service },
    "@/lib/server/organization": { getDefaultOrganization: () => ({ id: "00000000-0000-4000-8000-000000000040" }) },
  };
  runInNewContext(code, { module: compiled, exports: compiled.exports, require(id) { return modules[id]; }, Response, Date, URL });
  const request = (method, body) => new Request("http://localhost/api/v1/agent-document-read-grants", {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return { route: compiled.exports, request, calls };
}

test("owner can grant only one named key read access while the document remains unchanged", async () => {
  const document = { id: docId, owner_id: ownerId, status: "draft", meeting_record_id: null };
  const f = await fixture(document);
  const response = await f.route.POST(f.request("POST", {
    documentId: docId, agentKeyId: keyId, duration: "24h", reason: "EDU development handoff",
  }));
  assert.equal(response.status, 200);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].name, "os_grant_agent_document_read");
  assert.equal(f.calls[0].args.p_document, docId);
  assert.equal(f.calls[0].args.p_agent_key, keyId);
  assert.equal(document.status, "draft");
  assert.equal(document.owner_id, ownerId);
});

test("another owner's or shared document cannot receive a grant", async () => {
  for (const patch of [{ owner_id: keyId }, { status: "team" }, { meeting_record_id: keyId }]) {
    const f = await fixture({ id: docId, owner_id: ownerId, status: "draft", meeting_record_id: null, ...patch });
    const response = await f.route.POST(f.request("POST", {
      documentId: docId, agentKeyId: keyId, duration: "7d", reason: "EDU development handoff",
    }));
    assert.equal(response.status, 403);
    assert.equal(f.calls.length, 0);
  }
});

test("grant can be revoked for the exact document and key", async () => {
  const f = await fixture();
  const response = await f.route.DELETE(f.request("DELETE", { documentId: docId, agentKeyId: keyId }));
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls.map(call => [call.name, call.args.p_document, call.args.p_agent_key]),
    [["os_revoke_agent_document_read", docId, keyId]]);
});
