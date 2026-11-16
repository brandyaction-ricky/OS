import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

async function index(total, { mutate, view = "list", failAt } = {}) {
  const calls = [];
  let rows = Array.from({ length: total }, (_, i) => ({ id: `doc-${String(i).padStart(5, "0")}`, folder: "f" }));
  const from = () => {
    const call = { cursor: "", fields: "", limit: 0 };
    const query = {
      select(fields, options) { assert.equal(options, undefined, "no exact count scan"); call.fields = fields; return query; },
      neq() { return query; }, order() { return query; },
      limit(n) { call.limit = n; return query; },
      gt(field, value) { assert.equal(field, "id"); call.cursor = value; return query; },
      then(done) {
        calls.push(call);
        if (calls.length === failAt) return done({ error: { message: "offline" } });
        const data = rows.filter(row => row.id > call.cursor).slice(0, call.limit);
        if (mutate) rows = mutate(rows, calls.length);
        return done({ data, error: null });
      },
    };
    return query;
  };
  const source = await readFile(new URL("../lib/server/document-index.ts", import.meta.url), "utf8");
  const mod = { exports: {} };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module: mod, exports: mod.exports, require: name => ({
      "@/lib/http": { ApiError: Error },
      "./knowledge-page-access": { POLICY_FIELDS: "id,owner_id", readableKnowledgePages: async (_a, list) => new Set(list.filter(r => r.id !== "hidden").map(r => r.id)) },
    })[name],
  });
  const result = await mod.exports.documentIndex("all", { ownerId: "synthetic", supabase: { from } }, view);
  return { result, calls };
}

test("document index walks every page without count or OFFSET scans", async () => {
  const { result, calls } = await index(2500);
  assert.equal(result.length, 2500);
  assert.deepEqual(calls.map(c => c.cursor), ["", "doc-00999", "doc-01999"]);
  assert.equal((await index(0)).result.length, 0);
  assert.equal((await index(2000)).result.length, 2000);
});

test("deleting preceding rows during traversal does not skip later documents", async () => {
  const { result } = await index(2500, { mutate: (rows, page) => page === 1 ? rows.slice(100) : rows });
  assert.equal(result.length, 2500);
  assert.equal(new Set(result.map(r => r.id)).size, 2500);
  assert.equal(result.at(-1).id, "doc-02499");
});

test("an unsuccessful page fails the entire list rather than returning partial counts", async () => {
  await assert.rejects(index(2500, { failAt: 2 }));
});

test("folder counts read only folder and policy fields, with no separate count", async () => {
  assert.equal((await index(1, { view: "folders" })).calls[0].fields, "folder,id,owner_id");
  assert.match((await index(1)).calls[0].fields, /^title,/);
});
