import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as zod from "zod";

function moduleFor(path, modules) {
  const exports = {};
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, require: name => { if (!(name in modules)) throw Error(`Unexpected module ${name}`); return modules[name]; }, Response, console });
  return exports;
}

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const http = {
  ApiError,
  parseJson: request => request.json(),
  apiErrorResponse: error => Response.json({ error: { code: error.code, message: error.message } }, { status: error.status ?? 500 }),
};

test("complete document policy rows avoid another database read, while partial rows are hydrated", async () => {
  const complete = {
    id: "one", owner_id: "owner", status: "team", parent_document_id: null,
    category_id: null, meeting_record_id: null, archived_from_status: null,
    archived_by: null, source: "manual",
  };
  const reads = [];
  const pageAccess = moduleFor("lib/server/knowledge-page-access.ts", {
    "./knowledge-access": {
      knowledgeAccessContext: async actor => ({ actor, context: {} }),
      canReadDocument: () => true,
    },
    "@/lib/supabase/server": { createServiceSupabase: () => ({ from: table => {
      assert.equal(table, "os_documents");
      return { select: () => ({ in: async (_key, ids) => { reads.push(ids); return { data: ids.map(() => complete), error: null }; } }) };
    } }) },
  });
  assert.equal((await pageAccess.readableKnowledgePages({ ownerId: "owner" }, [complete])).has("one"), true);
  assert.equal(reads.length, 0);
  assert.equal((await pageAccess.readableKnowledgePages({ ownerId: "owner" }, [{ id: "one", owner_id: "owner", status: "team" }])).has("one"), true);
  assert.equal(reads.length, 1);
});

function categoryRoute({ count, role = "admin", owner = "owner", categoryOwner = "owner" }) {
  let archived = 0;
  let counted = 0;
  const category = { id: "3abcc61a-4cb0-4e7f-8eb1-c727c772cd93", space: "team", owner_id: categoryOwner };
  const actor = {
    role, ownerId: owner,
    supabase: {
      from: () => ({ select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: category, error: null }) }) }) }) }),
      rpc: async () => { archived += 1; return { error: null }; },
    },
  };
  const route = moduleFor("app/api/v1/knowledge/categories/route.ts", {
    "next/server": { NextResponse: Response }, zod,
    "@/lib/http": http,
    "@/lib/knowledge/model": { CATEGORY_COLORS: ["blue", "red"] },
    "@/lib/server/auth": { authenticateRequest: async () => actor },
    "@/lib/supabase/server": { createServiceSupabase: () => ({ from: () => ({ select: () => ({ eq: async () => { counted += 1; return { count, error: null }; } }) }) }) },
  });
  const request = new Request("http://localhost/api/v1/knowledge/categories", { method: "DELETE", body: JSON.stringify({ id: category.id }) });
  return { route, request, stats: () => ({ archived, counted }) };
}

test("vault category deletion preserves every linked document", async () => {
  const { route, request, stats } = categoryRoute({ count: 2 });
  const response = await route.DELETE(request);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "CATEGORY_IN_USE");
  assert.deepEqual(stats(), { archived: 0, counted: 1 });
});

test("team category deletion requires admin and only archives an empty category", async () => {
  const staff = categoryRoute({ count: 0, role: "member" });
  assert.equal((await staff.route.DELETE(staff.request)).status, 403);
  assert.deepEqual(staff.stats(), { archived: 0, counted: 0 });
  const admin = categoryRoute({ count: 0 });
  assert.equal((await admin.route.DELETE(admin.request)).status, 200);
  assert.deepEqual(admin.stats(), { archived: 1, counted: 1 });
});
