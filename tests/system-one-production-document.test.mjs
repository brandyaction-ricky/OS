import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";
import * as documents from "../lib/server/system-one-document-source.ts";
async function compile(path, modules, extra = {}) {
  const code = ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiled = { exports: {} };
  runInNewContext(code, { module: compiled, exports: compiled.exports, URL, ...extra, require(name) { assert.ok(Object.hasOwn(modules, name), name); return modules[name]; } });
  return compiled.exports;
}
const mod = await compile("../lib/server/system-one-production-document.ts", { zod: { z }, "@/lib/server/system-one-document-source": documents });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function harness() {
  const state = { calls: 0, actor: id(1), hook: () => {}, row: { id: id(2), title: "Synthetic document", content_md: "Synthetic body",
    current_version: 1, status: "draft", owner_id: id(1), team: "", brand: null, folder: "Synthetic",
    content_hash: createHash("md5").update("Synthetic body").digest("hex"), updated_at: "2026-01-01T00:00:00.000Z" } };
  const deps = { authenticate: async () => ({ principal: { id: state.actor, type: "user", role: "member", team: "", active: true, mustChangePassword: false },
    readHeads: async ids => { assert.deepEqual([...ids], [id(2)]); state.calls++; state.hook(); return state.row ? [state.row] : []; } }) };
  return { state, deps };
}
test("production document reads accessible drafts, projects summary only and never approves", async () => {
  const { deps } = harness(); const result = await mod.readProductionDocument(id(2), deps);
  assert.equal(result.status, "ready"); assert.equal(result.document.version, 1); assert.equal(result.document.status, "draft");
  assert.equal(result.executionAllowed, false); assert.equal(result.judgment, null);
  assert.equal(JSON.stringify(result).includes("Synthetic body"), false); assert.equal(JSON.stringify(result).includes("owner_id"), false);
});
for (const [name, change, code] of [
  ["missing", s => { s.row = null; }, "unavailable"],
  ["private other owner", s => { s.row.owner_id = id(3); }, "unavailable"],
  ["archived", s => { s.row.status = "archived"; }, "unavailable"],
  ["invalid hash", s => { s.row.content_hash = "a".repeat(32); }, "invalid_metadata"],
  ["version changes during reading", s => { s.hook = () => { if (s.calls === 2) s.row.current_version++; }; }, "stale"],
  ["access withdrawn on final read", s => { s.hook = () => { if (s.calls === 3) s.row.owner_id = id(3); }; }, "unavailable"],
]) test(`production document stops: ${name}`, async () => {
  const { state, deps } = harness(); change(state); assert.equal((await mod.readProductionDocument(id(2), deps)).code, code);
});
test("invalid ID never queries documents", async () => {
  const { state, deps } = harness(); assert.equal((await mod.readProductionDocument("bad", deps)).code, "invalid_input"); assert.equal(state.calls, 0);
});
test("production document route gates DEV, human auth and query shape; redacts unexpected data", async () => {
  let enabled = true, calls = 0;
  const api = await compile("../app/api/v1/system-one/production-document/route.ts", {
    "next/server": { NextResponse: Response }, "@/lib/system-one-content-evidence-gate": { canUseSystemOneContentEvidence: () => enabled },
    "@/lib/server/system-one-user-source": { createSystemOneUserDocumentSource: () => ({}) },
    "@/lib/server/system-one-production-document": { readProductionDocument: async () => { calls++; return { status: "ready", document: { id: id(2), title: "Synthetic", version: 1, status: "draft" }, privateBody: "PRIVATE" }; } },
  }, { process: { env: {} } });
  const req = (query = `id=${id(2)}`, token = "Bearer synthetic") => new Request(`https://synthetic.invalid/api?${query}`, { headers: token ? { authorization: token } : {} });
  enabled = false; assert.equal((await api.GET(req())).status, 404); enabled = true;
  assert.equal((await api.GET(req(undefined, ""))).status, 401); assert.equal((await api.GET(req(undefined, "Bearer bos_pat_test"))).status, 401);
  assert.equal((await api.GET(req(`id=${id(2)}&id=${id(3)}`))).status, 400); assert.equal(calls, 0);
  const response = await api.GET(req()); assert.match(response.headers.get("cache-control"), /no-store/); assert.equal((await response.text()).includes("PRIVATE"), false);
});
