import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as sourceModule from "../lib/server/system-one-document-source.ts";

// Execute the actual connector + authentication module against an in-memory
// read-only Supabase double. These are NOT connected Auth/RLS/DEV integration tests.
async function compile(path) {
  return ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const [authCode, httpCode, connectorCode] = await Promise.all([
  compile("../lib/server/auth.ts"), compile("../lib/http.ts"), compile("../lib/server/system-one-user-source.ts"),
]);
function evaluate(code, modules) {
  const compiledModule = { exports: {} };
  runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, Buffer, Date, AbortSignal,
    require(name) {
      assert.ok(Object.hasOwn(modules, name), `Unexpected module: ${name}`);
      return modules[name];
    },
  });
  return compiledModule.exports;
}
const userId = "00000000-0000-4000-8000-000000000001";
const sourceId = "00000000-0000-4000-8000-000000000002";
const criterionId = "00000000-0000-4000-8000-000000000003";
const selection = { source: { id: sourceId, expectedVersion: 1 }, criteria: [{ id: criterionId, expectedVersion: 1 }] };
function row(id) {
  const content_md = "Synthetic offline document.";
  return { id, title: "Synthetic", content_md, status: "canonical", owner_id: userId, team: "", brand: null,
    folder: "/synthetic", current_version: 1, content_hash: crypto.createHash("md5").update(content_md).digest("hex"),
    updated_at: "2026-01-01T00:00:00.000Z" };
}
function setup(overrides = {}) {
  const state = { profile: { role: "member", team: "synthetic", is_active: true, must_change_password: false },
    userError: false, profileError: false, readError: false, rows: [row(sourceId), row(criterionId)], ...overrides };
  const calls = { auth: 0, profiles: 0, documents: 0, createUser: 0, ids: [] };
  const supabase = {
    auth: { async getUser(token) {
      calls.auth += 1;
      assert.equal(token, "synthetic-user-token");
      return { data: { user: state.userError ? null : { id: userId, email: "synthetic@example.invalid" } }, error: state.userError };
    } },
    from(table) {
      if (table === "os_profiles") {
        calls.profiles += 1;
        return { select(fields) {
          assert.equal(fields, "role,team,is_active,must_change_password");
          return { eq(field, id) {
            assert.equal(field, "id"); assert.equal(id, userId);
            return { async maybeSingle() { return { data: state.profile, error: state.profileError }; } };
          } };
        } };
      }
      assert.equal(table, "os_documents");
      calls.documents += 1;
      return { select(fields) {
        assert.equal(fields, sourceModule.SYSTEM_ONE_DOCUMENT_FIELDS);
        return { in(field, ids) {
          assert.equal(field, "id");
          calls.ids.push([...ids]);
          return { async abortSignal(signal) {
            assert.equal(signal instanceof AbortSignal, true);
            assert.equal(signal.aborted, false);
            return { data: state.rows, error: state.readError ? { message: "PRIVATE DATABASE ERROR" } : null };
          } };
        } };
      } };
    },
  };
  const http = evaluate(httpCode, { "next/server": { NextResponse: Response } });
  const auth = evaluate(authCode, { "node:crypto": crypto, "@/lib/http": http,
    "@/lib/supabase/server": {
      createUserSupabase(token) { calls.createUser += 1; assert.equal(token, "synthetic-user-token"); return supabase; },
      createServiceSupabase() { assert.fail("Service-role client must never be created"); },
    },
  });
  const connector = evaluate(connectorCode, {
    "@/lib/server/auth": { authenticateRequest(request, options) {
      assert.equal(options.allowAgent, false); assert.equal(options.allowPasswordChangeRequired, false);
      return auth.authenticateRequest(request, options);
    } },
    "@/lib/server/system-one-document-source": sourceModule,
  });
  const deps = (authorization = "Bearer synthetic-user-token") => connector.createSystemOneUserDocumentSource(new Request("https://synthetic.example.invalid", {
    headers: authorization ? { authorization } : {},
  }));
  return { state, calls, deps };
}

test("connected-source construction is inert; load uses one fresh user-bound SELECT", async () => {
  const { calls, deps } = setup();
  const dependencies = deps();
  assert.equal(calls.createUser, 0);
  const result = await sourceModule.loadSystemOneDocumentBundle(selection, dependencies);
  assert.equal(result.status, "ready");
  assert.equal(result.bundle.policyStatus, "unverified");
  assert.deepEqual(calls, { auth: 1, profiles: 1, documents: 1, createUser: 1, ids: [[sourceId, criterionId]] });
});

test("anonymous and agent requests stop before a client, lookup, or agent timestamp write", async () => {
  for (const authorization of ["", "Bearer bos_pat_synthetic"]) {
    const { calls, deps } = setup();
    assert.deepEqual(await sourceModule.loadSystemOneDocumentBundle(selection, deps(authorization)), {
      status: "stopped", code: "authentication_failed",
    });
    assert.equal(calls.createUser, 0); assert.equal(calls.documents, 0);
  }
});

test("expired auth, failed/missing/inactive profile and required password change block document reads", async () => {
  for (const fields of [
    { userError: true }, { profileError: true }, { profile: null },
    { profile: { role: "member", team: "", is_active: false, must_change_password: false } },
    { profile: { role: "member", team: "", is_active: true, must_change_password: true } },
  ]) {
    const { calls, deps } = setup(fields);
    assert.deepEqual(await sourceModule.loadSystemOneDocumentBundle(selection, deps()), { status: "stopped", code: "authentication_failed" });
    assert.equal(calls.documents, 0);
  }
});

test("recheck repeats real auth/profile code and blocks an account deactivated after the first read", async () => {
  const { state, calls, deps } = setup();
  const dependencies = deps();
  const first = await sourceModule.loadSystemOneDocumentBundle(selection, dependencies);
  assert.equal(first.status, "ready");
  state.profile.is_active = false;
  assert.deepEqual(await sourceModule.recheckSystemOneDocumentBundle(first.bundle, dependencies), { status: "stopped", code: "authentication_failed" });
  assert.equal(calls.auth, 2); assert.equal(calls.profiles, 2); assert.equal(calls.documents, 1);
});

test("RLS-filtered missing criterion returns no partial source, with no historical/service fallback", async () => {
  const { state, calls, deps } = setup();
  const first = await sourceModule.loadSystemOneDocumentBundle(selection, deps());
  assert.equal(first.status, "ready");
  state.rows.pop();
  assert.deepEqual(await sourceModule.recheckSystemOneDocumentBundle(first.bundle, deps()), { status: "stopped", code: "unavailable" });
  assert.equal(calls.documents, 2);
});

test("read errors are redacted and never trigger retry, write, model call, or service fallback", async () => {
  const { calls, deps } = setup({ readError: true });
  const result = await sourceModule.loadSystemOneDocumentBundle(selection, deps());
  assert.deepEqual(result, { status: "stopped", code: "read_failed" });
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  assert.equal(calls.documents, 1);
});
