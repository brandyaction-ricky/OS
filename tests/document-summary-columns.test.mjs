import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

async function route(selected) {
  const source = await readFile(new URL("../app/api/v1/documents/route.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const row = { id: "synthetic-doc", title: "t", status: "canonical", owner_id: "synthetic-user", content_md: "body" };
  const query = new Proxy({}, { get: (_target, key) => key === "then" ? (done => done({ data: [row], error: null, count: 1 })) : key === "select" ? (columns => { selected.push(columns); return query; }) : () => query });
  const mod = { exports: {} };
  const modules = {
    "next/server": { NextResponse: { json: body => ({ status: 200, json: async () => body }) } },
    zod: { ZodError: class {} }, "@/lib/http": { apiErrorResponse: error => { throw error; }, ApiError: Error, parseJson: () => ({}) },
    "@/lib/server/auth": { authenticateRequest: async () => ({ id: "synthetic-user", ownerId: "synthetic-user" }) },
    "@/lib/server/indexing": {}, "@/lib/supabase/server": { createServiceSupabase: () => ({ from: () => query }) },
    "@/lib/server/knowledge-page-access": { POLICY_FIELDS: "id,owner_id,status,parent_document_id,category_id,meeting_record_id,archived_from_status,archived_by,source", readableKnowledgePages: async (_actor, rows) => new Set(rows.map(r => r.id)) },
    "@/lib/server/document-proposals": {}, "@/lib/validation": {},
    "@/lib/server/document-index": { documentIndex: async scope => (selected.push(`index:${scope}`), [{ folder: "b" }, { folder: "a" }, { folder: "" }, { folder: "a" }]) },
  };
  runInNewContext(code, { module: mod, exports: mod.exports, require: name => modules[name], URL });
  return mod.exports;
}

test("summary lists never read document bodies; full lists still do", async () => {
  const selected = [], api = await route(selected);
  const summary = await (await api.GET(new Request("https://example.invalid/api/v1/documents?view=summary&scope=mine_company&limit=3"))).json();
  assert.ok(!selected[0].includes("content_md") && selected[0] !== "*");
  assert.equal(summary.documents[0].content_md, undefined);
  await api.GET(new Request("https://example.invalid/api/v1/documents?limit=3"));
  assert.equal(selected[1], "*");
});

test("folder list reuses the policy-complete document index", async () => {
  const selected = [], api = await route(selected);
  const body = await (await api.GET(new Request("https://example.invalid/api/v1/documents?view=folders"))).json();
  assert.equal(JSON.stringify(body.folders), JSON.stringify(["a", "b"]));
  assert.deepEqual(selected, ["index:all"]);
  const index = await readFile(new URL("../lib/server/document-index.ts", import.meta.url), "utf8");
  assert.match(index, /`[^`]*\$\{POLICY_FIELDS\}`/);
});
