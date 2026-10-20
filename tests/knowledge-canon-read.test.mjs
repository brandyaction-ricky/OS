import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { canReadDocument } from "../lib/knowledge/access.ts";

class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const actor = { ownerId: "reader", type: "user", role: "member", memberKind: "staff", active: true, allowedStatuses: ["canonical"] };
const policyFields = "id,owner_id,status,parent_document_id,category_id,meeting_record_id,archived_from_status,archived_by,source,reader_scope,steward_id";
const doc = (i, patch = {}) => ({ id: `10000000-0000-0000-0000-${String(i).padStart(12, "0")}`, title: `정본 ${i}`, folder: "규칙",
  owner_id: "reader", status: "canonical", parent_document_id: null, category_id: null, meeting_record_id: null,
  archived_from_status: null, archived_by: null, source: "manual", steward_id: "steward", reader_scope: "all", review_due_on: null,
  current_version: 2, updated_at: "2026-10-11T00:00:00Z", content_md: "should never be loaded", ...patch });

function load(path, modules) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, require: name => { assert.ok(name in modules, name); return modules[name]; }, Response });
  return exports;
}

function endpoint({ documents = [doc(1)], proposals = [], authenticated = true, failureTable } = {}) {
  const calls = [], policyChecks = [];
  const rows = { os_documents: documents, os_document_proposals: proposals, os_profiles: [{ id: "steward", display_name: "담당자", is_active: true }] };
  const db = { from(table) {
    const call = { table, filters: [], columns: "" }; calls.push(call);
    let start = 0, end = 499;
    const query = new Proxy({}, { get: (_target, key) => {
      if (key === "then") return resolve => {
        if (table === failureTable) return resolve({ data: null, error: { message: "private query details" } });
        let result = rows[table] ?? [];
        for (const [kind, field, value] of call.filters) result = result.filter(row => kind === "eq" ? row[field] === value : kind === "gt" ? row[field] > value : value.includes(row[field]));
        result = result.slice(start, end + 1).map(row => Object.fromEntries(call.columns.split(",").map(field => [field, row[field]])));
        return resolve({ data: result, error: null });
      };
      return (...args) => { if (key === "select") call.columns = args[0]; if (["eq", "gt", "in"].includes(key)) call.filters.push([key, ...args]); if (key === "range") [start, end] = args; if (key === "limit") end = args[0] - 1; return query; };
    } });
    return query;
  }, rpc() { throw Error("canon lists must not run per-person approval RPCs"); } };
  const modules = {
    "next/server": { NextResponse: Response },
    "@/lib/http": { ApiError, apiErrorResponse: error => Response.json({ error: { code: error.code, message: error.message } }, { status: error.status ?? 500 }) },
    "@/lib/server/auth": { authenticateRequest: async () => { if (!authenticated) throw new ApiError(401, "AUTH_REQUIRED", "로그인 필요"); return { ...actor, supabase: db }; } },
    "@/lib/supabase/server": { createServiceSupabase: () => db },
    "@/lib/server/knowledge-access": { knowledgeAccessContext: async () => ({ actor }) },
    "@/lib/server/knowledge-page-access": { POLICY_FIELDS: policyFields, readableKnowledgePages: async (_actor, rows) => { policyChecks.push(rows); return new Set(rows.filter(row => row.parent_document_id !== "hidden-parent").map(row => row.id)); } },
  };
  return { ...load("../app/api/v1/knowledge/canon/route.ts", modules), calls, policyChecks };
}

test("canon lists query only summaries and open proposal IDs while preserving more than one page", async () => {
  const documents = Array.from({ length: 1105 }, (_, i) => doc(i, i === 777 ? { parent_document_id: "hidden-parent" } : {}));
  const proposals = [{ id: "proposal-visible", document_id: documents[5].id, status: "open" }, { id: "proposal-private", document_id: documents[777].id, status: "open" }, { id: "proposal-old", document_id: documents[6].id, status: "approved" }];
  const api = endpoint({ documents, proposals });
  const response = await api.GET(new Request("http://localhost/api/v1/knowledge/canon")), body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.documents.length, 1104);
  assert.deepEqual(body.proposalDocumentIds, [documents[5].id]);
  assert.deepEqual(body.people, [{ id: "steward", display_name: "담당자" }]);
  assert.equal(api.policyChecks.length, 1, "all canonical summaries share one ancestor-policy pass");
  assert.equal(api.calls.filter(call => call.table === "os_documents").length, 3);
  assert.equal(api.calls.filter(call => call.table === "os_document_proposals").length, 1, "no request per 100 canonical document IDs");
  assert.deepEqual([...new Set(api.calls.map(call => call.table))].sort(), ["os_document_proposals", "os_documents", "os_profiles"]);
  assert.ok(api.calls.every(call => !call.columns.includes("*") && !call.columns.includes("content_md")));
  assert.doesNotMatch(JSON.stringify(body), /should never|hidden-parent|proposal-private|owner_id/);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("canon authorization and read failures never become an empty successful list", async () => {
  const signedOut = endpoint({ authenticated: false });
  assert.equal((await signedOut.GET(new Request("http://localhost"))).status, 401);
  assert.deepEqual(signedOut.calls, []);
  for (const failureTable of ["os_documents", "os_document_proposals", "os_profiles"]) {
    const response = await endpoint({ failureTable }).GET(new Request("http://localhost"));
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /private query details/);
  }
});

test("complete policy projections avoid duplicate row reads but still check private ancestors and meeting scope", async () => {
  const parent = doc(2, { status: "draft", owner_id: "other" });
  const child = doc(1, { parent_document_id: parent.id });
  const meeting = doc(3, { meeting_record_id: "private-meeting" });
  const reads = [];
  const service = { from() { return { select() { return this; }, in: async (_field, ids) => { reads.push(Array.from(ids)); return { data: [parent, child, meeting].filter(row => ids.includes(row.id)), error: null }; } }; } };
  const access = load("../lib/server/knowledge-page-access.ts", {
    "./knowledge-access": { canReadDocument, knowledgeAccessContext: async actor => ({ actor, context: {} }) },
    "@/lib/supabase/server": { createServiceSupabase: () => service },
  });
  assert.deepEqual([...await access.readableKnowledgePages(actor, [child, meeting])], []);
  assert.deepEqual(reads, [[parent.id]], "complete child projection is reused, missing parent is still fetched");
  reads.length = 0;
  assert.deepEqual([...await access.readableKnowledgePages(actor, [{ id: child.id, owner_id: "reader", status: "canonical" }])], []);
  assert.deepEqual(reads, [[child.id], [parent.id]], "partial summaries hydrate omitted policy fields before checking access");
});
