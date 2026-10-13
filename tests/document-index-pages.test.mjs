import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

async function index(total, counted) {
  const ranges = [];
  const rows = Array.from({ length: total }, (_, i) => ({ id: `doc-${String(i).padStart(5, "0")}`, folder: "f" }));
  const from = () => {
    let head = false, start = 0, end = 0;
    const query = new Proxy({}, { get: (_t, key) => key === "then"
      ? done => done(head ? { count: counted, error: null } : { data: rows.slice(start, end + 1), error: null })
      : (...args) => { if (key === "select") head = Boolean(args[1]?.head); if (key === "range") { [start, end] = args; ranges.push(start); } return query; } });
    return query;
  };
  const source = await readFile(new URL("../lib/server/document-index.ts", import.meta.url), "utf8");
  const mod = { exports: {} };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: mod, exports: mod.exports, require: name => ({
    "@/lib/http": { ApiError: Error },
    "./knowledge-page-access": { POLICY_FIELDS: "id,owner_id", readableKnowledgePages: async (_a, list) => new Set(list.map(r => r.id)) },
  })[name] });
  const result = await mod.exports.documentIndex("all", { ownerId: "synthetic", supabase: { from } });
  return { result, ranges };
}

test("document index reads counted pages together and still picks up rows added after the count", async () => {
  const exact = await index(2500, 2500);
  assert.equal(exact.result.length, 2500);
  assert.deepEqual(exact.ranges, [0, 1000, 2000]);
  const grew = await index(3200, 2000);
  assert.equal(grew.result.length, 3200);
  assert.deepEqual(grew.ranges, [0, 1000, 2000, 3000]);
  assert.equal((await index(0, 0)).result.length, 0);
});
