import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as source from "../lib/server/system-one-content-source.ts";
import * as packaging from "../lib/server/system-one-packaging-source.ts";
const code = ts.transpileModule(await readFile(new URL("../lib/server/system-one-user-content-source.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
test("content connector uses fresh human auth and owner-filtered read-only topic SELECT", async () => {
  const calls = []; const actor = { type: "user", id: "synthetic", user: { id: "synthetic" }, mustChangePassword: false,
    supabase: { from(table) {
      assert.equal(table, "os_records"); const query = {
        select(fields) { assert.equal(fields, source.SYSTEM_ONE_CONTENT_FIELDS); return query; },
        eq(...args) { calls.push(args); return query; }, is(...args) { calls.push(args); return query; },
        abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return query; },
        async maybeSingle() { return { data: null, error: null }; },
      }; return query;
    } } };
  let authCalls = 0; const request = new Request("https://synthetic.example.invalid");
  const modules = {
    "@/lib/server/auth": { authenticateRequest: async (received, options) => {
      assert.equal(received, request); assert.equal(options.allowAgent, false); assert.equal(options.allowPasswordChangeRequired, false);
      authCalls++; return actor;
    } }, "@/lib/server/system-one-content-source": source, "@/lib/server/system-one-packaging-source": packaging,
  };
  const compiled = { exports: {} };
  runInNewContext(code, { module: compiled, exports: compiled.exports, AbortSignal,
    require(name) { assert.ok(Object.hasOwn(modules, name)); return modules[name]; } });
  const deps = compiled.exports.createSystemOneUserContentSource(request);
  assert.equal(authCalls, 0);
  const session = await deps.authenticate(); await session.readHead("topic-id");
  assert.equal(authCalls, 1);
  assert.deepEqual(calls.map(args => Array.from(args)), [["id", "topic-id"], ["record_type", "content_topic"], ["owner_id", "synthetic"], ["archived_at", null]]);
  actor.user.id = "other";
  await assert.rejects(deps.authenticate(), /SYSTEM_ONE_USER_REQUIRED/);
});

test("packaging connector reads the complete bounded owner set through the human session", async () => {
  const calls = [];
  const query = {
    select(fields) { assert.equal(fields, packaging.SYSTEM_ONE_PACKAGING_FIELDS); return query; },
    eq(...args) { calls.push(args); return query; }, is(...args) { calls.push(args); return query; },
    order(value) { assert.equal(value, "id"); return query; },
    limit(value) { assert.equal(value, 101); return query; },
    async abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return { data: [], error: null }; },
  };
  const actor = { type: "user", id: "synthetic", user: { id: "synthetic" }, mustChangePassword: false,
    supabase: { from(table) { assert.equal(table, "os_records"); return query; } } };
  const modules = { "@/lib/server/auth": { authenticateRequest: async (_request, options) => {
    assert.equal(options.allowAgent, false); assert.equal(options.allowPasswordChangeRequired, false); return actor;
  } }, "@/lib/server/system-one-content-source": source, "@/lib/server/system-one-packaging-source": packaging };
  const compiled = { exports: {} };
  runInNewContext(code, { module: compiled, exports: compiled.exports, AbortSignal,
    require(name) { assert.ok(Object.hasOwn(modules, name)); return modules[name]; } });
  const deps = compiled.exports.createSystemOneUserPackagingSource(new Request("https://synthetic.example.invalid"));
  const session = await deps.authenticate(); assert.deepEqual(await session.readPackages("topic-id"), []);
  assert.deepEqual(calls.map(args => Array.from(args)), [["parent_id", "topic-id"], ["record_type", "content_package"], ["owner_id", "synthetic"], ["archived_at", null]]);
  actor.mustChangePassword = true; await assert.rejects(deps.authenticate(), /SYSTEM_ONE_USER_REQUIRED/);
});
