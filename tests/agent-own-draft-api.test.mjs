import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import * as crypto from "node:crypto";
import test from "node:test";
import ts from "typescript";
import * as zod from "zod";
import * as access from "../lib/knowledge/access.ts";
import * as documentAccess from "../lib/server/document-access.ts";
import * as keyPolicy from "../lib/agent-key-policy.ts";
import * as relevance from "../lib/search-relevance.ts";
import * as diagnostics from "../lib/search-diagnostics.ts";
import { DOCUMENT_STATUSES } from "../lib/types.ts";

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = uuid(1), other = uuid(2), org = uuid(3), key = uuid(4);
const token = "bos_pat_fixture";
async function load(path, modules = {}, extras = {}) {
  const code = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiled = { exports: {} };
  const available = { "next/server": { NextResponse: Response }, zod, "node:crypto": crypto, ...modules };
  runInNewContext(code, {
    module: compiled, exports: compiled.exports,
    require(id) { assert.ok(id in available, `Unmocked module: ${id}`); return available[id]; },
    URL, URLSearchParams, Date, Response, AbortSignal, Buffer,
    process: { env: {} }, console: { error() {} }, ...extras,
  });
  return compiled.exports;
}
function draft(n, overrides = {}) {
  return { id: uuid(n), owner_id: owner, source: "mcp", status: "draft", title: "needle",
    content_md: "needle reference", folder: "unchanged", current_version: 7,
    updated_at: "2026-01-01T00:00:00Z", parent_document_id: null, ...overrides };
}
// Exercise PostgREST filter semantics over synthetic rows; no network/database.
function splitFilters(expression) {
  const parts = []; let depth = 0, start = 0;
  for (let i = 0; i < expression.length; i++) {
    if (expression[i] === "(") depth++;
    if (expression[i] === ")") depth--;
    if (expression[i] === "," && depth === 0) { parts.push(expression.slice(start, i)); start = i + 1; }
  }
  return [...parts, expression.slice(start)];
}
function matches(row, expression) {
  if (expression.startsWith("and(")) return splitFilters(expression.slice(4, -1)).every(part => matches(row, part));
  const [, field, op, value] = expression.match(/^([\w_]+)\.(eq|ilike)\.(.*)$/) ?? [];
  assert.ok(field, `Unsupported fixture filter: ${expression}`);
  return op === "eq" ? row[field] === value : String(row[field] ?? "").toLowerCase().includes(value.replaceAll("%", "").toLowerCase());
}
async function fixture(documents, options = {}) {
  const reads = [], writes = [], rpcCalls = [];
  const profile = { id: owner, is_active: true, member_kind: "staff", ...options.profile };
  const tier = keyPolicy.agentKeyPolicy(options.tier ?? "read");
  const agentKey = { id: key, name: "fixture", active: true, owner_user_id: owner, organization_id: org,
    scopes: tier.scopes, allowed_statuses: tier.allowedStatuses, enforce_write_statuses: true, ...options.agentKey };
  const tables = { os_documents: documents, os_profiles: [profile], os_agent_keys: [agentKey], os_records: [], os_meeting_attendees: [] };
  const db = {
    from(table) {
      let fields = "*", limit = Infinity;
      const predicates = [];
      const result = () => {
        let rows = (tables[table] ?? []).filter(row => predicates.every(predicate => predicate(row))).slice(0, limit);
        if (fields !== "*") rows = rows.map(row => Object.fromEntries(fields.split(",").filter(field => field in row).map(field => [field, row[field]])));
        return { data: rows, error: null };
      };
      const q = {
        select(value) { fields = value; reads.push({ table, fields }); return q; },
        eq(field, value) { if (field !== "key_hash") predicates.push(row => row[field] === value); return q; },
        in(field, values) { predicates.push(row => values.includes(row[field])); return q; },
        is(field, value) { predicates.push(row => row[field] === value); return q; },
        or(expression) { predicates.push(row => splitFilters(expression).some(part => matches(row, part))); return q; },
        order() { return q; }, range() { return q; }, limit(value) { limit = value; return q; }, abortSignal() { return q; },
        update(value) { writes.push({ table, value }); return q; },
        single: async () => ({ ...result(), data: result().data[0] ?? null }),
        maybeSingle: async () => ({ ...result(), data: result().data[0] ?? null }),
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
      return q;
    },
    rpc(name, args) {
      rpcCalls.push({ name, args });
      assert.equal(name, "os_search_knowledge", "Read tests must never invoke a write RPC");
      return { abortSignal: async () => options.rpcError ? { data: null, error: options.rpcError } : { data: options.rpcRows ?? [], error: null } };
    },
  };
  const http = await load("lib/http.ts");
  const service = { createServiceSupabase: () => db, createUserSupabase() { throw Error("No human credentials in fixture"); } };
  const common = { "@/lib/http": http, "@/lib/supabase/server": service };
  const auth = await load("lib/server/auth.ts", { ...common, "@/lib/agent-key-policy": keyPolicy, "./document-access": documentAccess });
  const organization = await load("lib/server/organization.ts", common);
  const context = await load("lib/server/knowledge-access.ts", { ...common, "@/lib/knowledge/access": access });
  const pages = await load("lib/server/knowledge-page-access.ts", { ...common, "./knowledge-access": context });
  const validation = await load("lib/validation.ts", { "./types": { DOCUMENT_STATUSES } });
  const search = await load("lib/server/search.ts", { ...common,
    "@/lib/search-diagnostics": diagnostics, "@/lib/validation": validation, "@/lib/search-relevance": relevance,
    "./knowledge-page-access": pages, "./embeddings": { createEmbeddings() { throw Error("No external AI in fixture"); } },
  });
  const apiModules = { ...common, "@/lib/server/auth": auth, "@/lib/server/organization": organization,
    "@/lib/server/document-access": documentAccess, "@/lib/server/knowledge-page-access": pages,
    "@/lib/server/indexing": { indexDocument() { throw Error("No writes in read fixture"); } },
    "@/lib/server/document-proposals": { createCanonicalProposal() { throw Error("No proposals in read fixture"); } },
    "@/lib/validation": validation, "@/lib/server/search": search,
  };
  const detail = await load("app/api/v1/knowledge-documents/route.ts", apiModules);
  const searchRoute = await load("app/api/v1/search/route.ts", apiModules);
  const mcpTools = await load("lib/server/mcp.ts");
  const forwarded = [];
  const mcp = await load("app/api/mcp/route.ts", { "@/lib/server/mcp": mcpTools }, {
    fetch: async (url, init) => {
      forwarded.push({ url, init });
      const request = new Request(url, init);
      return url.pathname === "/api/v1/search" ? searchRoute.POST(request) : detail.GET(request);
    },
  });
  async function call(name, args) {
    const response = await mcp.POST(new Request(`http://localhost/api/mcp?organizationId=${org}`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }));
    const { result } = await response.json();
    return result;
  }
  return { call, detail, reads, writes, forwarded, rpcCalls };
}

test("actual MCP adapter → authentication → detail → hydrated policy reads own AI draft with ID/version intact", async () => {
  for (const tier of ["read", "draft", "write"]) {
    const doc = draft(10), f = await fixture([doc], { tier });
    const result = await f.call("get_document", { document_id: doc.id });
    assert.notEqual(result.isError, true);
    assert.deepEqual(JSON.parse(result.content[0].text).document, doc);
    const forwarded = f.forwarded[0];
    assert.equal(forwarded.url.searchParams.get("organizationId"), org);
    assert.equal(forwarded.init.headers.Authorization, `Bearer ${token}`);
    assert.ok(f.reads.some(read => read.fields.includes("meeting_record_id") && read.fields.includes("source")));
    assert.ok(f.writes.every(write => write.table === "os_agent_keys" && Object.keys(write.value).join() === "last_used_at"));
  }
});
test("detail denies other owners, human/imported notes, archived/review drafts and meeting privacy", async () => {
  for (const overrides of [
    { owner_id: other }, { source: "wiki" }, { source: "manual" }, { source: "obsidian_vault" }, { source: undefined },
    { status: "archived", archived_from_status: "draft" }, { status: "review" }, { status: "reviewed" }, { meeting_record_id: uuid(99) },
  ]) {
    const doc = draft(10, overrides), f = await fixture([doc]);
    const response = await f.detail.GET(new Request(`http://localhost/api/v1/knowledge-documents?organizationId=${org}&documentId=${doc.id}`, { headers: { authorization: `Bearer ${token}` } }));
    assert.equal(response.status, 403, JSON.stringify(overrides));
    assert.equal((await response.json()).error.code, "DOCUMENT_FORBIDDEN");
  }
});
test("ancestor hydration cannot bypass a private parent, missing parent or cycle", async () => {
  for (const parent of [draft(11, { source: "wiki" }), null, draft(11, { parent_document_id: uuid(10) })]) {
    const doc = draft(10, { parent_document_id: uuid(11) }), f = await fixture(parent ? [doc, parent] : [doc]);
    assert.equal((await f.call("get_document", { document_id: doc.id })).isError, true);
  }
  const doc = draft(10, { parent_document_id: uuid(11) }), f = await fixture([doc, draft(11)]);
  assert.notEqual((await f.call("get_document", { document_id: doc.id })).isError, true);
});
test("partner, inactive/expired/revoked key, inactive owner and missing read scope still fail closed", async () => {
  for (const options of [
    { profile: { member_kind: "partner" } }, { profile: { is_active: false } }, { profile: { must_change_password: true } },
    { agentKey: { active: false } }, { agentKey: { expires_at: "2000-01-01T00:00:00Z" } },
    { agentKey: { scopes: ["knowledge.write"] } }, { agentKey: { organization_id: other } },
  ]) {
    const doc = draft(10), f = await fixture([doc], options);
    assert.equal((await f.call("get_document", { document_id: doc.id })).isError, true);
  }
});
test("MCP search finds own draft and never leaks another owner's draft or human note", async () => {
  const docs = [draft(10), draft(11, { owner_id: other }), draft(12, { source: "wiki" }), draft(13, { source: "obsidian_vault" }), draft(14, { status: "archived", archived_from_status: "draft" })];
  const f = await fixture(docs);
  const result = await f.call("search_knowledge", { query: "needle" });
  assert.notEqual(result.isError, true);
  assert.deepEqual(JSON.parse(result.content[0].text).results.map(row => row.documentId), [uuid(10)]);
  assert.ok(f.rpcCalls.every(call => !call.args.p_statuses.includes("draft")));
  const canonicalOnly = await f.call("search_knowledge", { query: "needle", include_my_drafts: false });
  assert.deepEqual(JSON.parse(canonicalOnly.content[0].text).results, []);
});
test("own draft participates even when the shared vector result page is full; fallback stays private", async () => {
  const shared = draft(11, { status: "canonical", owner_id: other, title: "shared", content_md: "needle" });
  for (const rpcError of [undefined, { code: "57014", message: "timeout" }]) {
    const f = await fixture([draft(10), shared, draft(12, { owner_id: other })], { rpcError,
      rpcRows: [{ document_id: shared.id, title: shared.title, status: shared.status, chunk_text: "needle", score: 0.1 }],
    });
    const result = await f.call("search_knowledge", { query: "needle", top_k: 1 });
    assert.deepEqual(JSON.parse(result.content[0].text).results.map(row => row.documentId), [uuid(10)]);
  }
});
test("read-only keys gain no edit/delete permission from own-draft read eligibility", async () => {
  const doc = draft(10), f = await fixture([doc]);
  for (const method of ["PATCH", "DELETE"]) {
    const response = await f.detail[method](new Request(`http://localhost/api/v1/knowledge-documents?organizationId=${org}&documentId=${doc.id}`, {
      method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(method === "PATCH" ? { body: JSON.stringify({ organizationId: org, documentId: doc.id, title: "replacement" }) } : {}),
    }));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "AGENT_SCOPE_REQUIRED");
  }
  assert.equal(f.writes.length, 0);
});
