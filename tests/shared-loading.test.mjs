import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as crypto from "node:crypto";
import ts from "typescript";

const turn = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function load(path, modules, globals = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  runInNewContext(code, { module: mod, exports: mod.exports, require: name => { assert.ok(name in modules, name); return modules[name]; }, ...globals });
  return mod.exports;
}
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

async function authFixture(hr = true) {
  const calls = [], user = deferred(), profile = deferred(), active = deferred();
  const db = {
    auth: { getUser: token => { calls.push(["user", token]); return user.promise; } },
    from(table) {
      assert.equal(table, "os_profiles");
      const query = { select: () => query, eq: (_key, id) => { assert.equal(id, "fixture-user"); return query; }, maybeSingle: () => { calls.push(["profile"]); return profile.promise; } };
      return query;
    },
    rpc(name) { assert.equal(name, "os_hr_session_active"); calls.push(["hr"]); return active.promise; },
  };
  const auth = await load("lib/server/auth.ts", {
    "node:crypto": crypto, "@/lib/hr/gate": { hrWorkspaceEnabled: () => hr },
    "@/lib/http": { ApiError, getBearerToken: () => "fixture-token" },
    "@/lib/supabase/server": { createUserSupabase: () => db },
    "@/lib/agent-key-policy": {}, "./document-access": {},
  });
  return { calls, user, profile, active, authenticate: options => auth.authenticateRequest({}, options) };
}
const activeProfile = { data: { role: "member", team: "fixture", is_active: true, must_change_password: false }, error: null };
const activeUser = { data: { user: { id: "fixture-user" } }, error: null };

test("authentication verifies the token before concurrent account checks and waits for both", async () => {
  const fixture = await authFixture();
  let settled = false;
  const result = fixture.authenticate().then(value => { settled = true; return value; });
  assert.deepEqual(fixture.calls, [["user", "fixture-token"]]);
  fixture.user.resolve(activeUser);
  await turn();
  assert.deepEqual(fixture.calls, [["user", "fixture-token"], ["profile"], ["hr"]]);
  fixture.profile.resolve(activeProfile);
  await turn();
  assert.equal(settled, false, "an active profile cannot bypass an unresolved HR check");
  fixture.active.resolve({ data: true, error: null });
  assert.equal((await result).id, "fixture-user");
});

test("parallel account checks retain disabled, HR-error, and password-change failures", async () => {
  for (const [profile, active, code] of [
    [{ data: { ...activeProfile.data, is_active: false } }, { data: true }, "ACCOUNT_DISABLED"],
    [activeProfile, { data: false }, "ACCOUNT_DISABLED"],
    [activeProfile, { error: { message: "unavailable" } }, "HR_SESSION_UNAVAILABLE"],
    [{ data: { ...activeProfile.data, must_change_password: true } }, { data: true }, "PASSWORD_CHANGE_REQUIRED"],
  ]) {
    const fixture = await authFixture();
    const result = assert.rejects(fixture.authenticate(), error => error.code === code);
    fixture.user.resolve(activeUser); fixture.profile.resolve(profile); fixture.active.resolve(active);
    await result;
  }
  const invalid = await authFixture();
  const rejected = assert.rejects(invalid.authenticate(), error => error.code === "INVALID_SESSION");
  invalid.user.resolve({ data: { user: null }, error: {} });
  await rejected;
  assert.equal(invalid.calls.length, 1, "invalid tokens must not initiate account reads");
});

test("disabled HR rollout skips only the HR check and allowed password changes preserve their gate", async () => {
  const fixture = await authFixture(false);
  const result = fixture.authenticate({ allowPasswordChangeRequired: true });
  fixture.user.resolve(activeUser);
  fixture.profile.resolve({ data: { ...activeProfile.data, must_change_password: true } });
  assert.equal((await result).mustChangePassword, true);
  assert.deepEqual(fixture.calls.map(call => call[0]), ["user", "profile"]);
});

async function clientFixture(browser = true) {
  const calls = [];
  const api = await load("lib/api-client.ts", {
    "./html-entities": { decodeHtmlEntities: text => text }, "./knowledge/graph-transport": {}, "./development-attachments": {},
  }, {
    Headers, FormData, URLSearchParams, structuredClone,
    ...(browser ? { window: {} } : {}),
    fetch(path, options) {
      const response = deferred();
      calls.push({ path, options, reply: (body, status = 200) => response.resolve(Response.json(body, { status })) });
      return response.promise;
    },
  });
  return { api, calls };
}
const recordBody = { records: [{ id: "fixture-row", record_type: "task", title: "fixture", metadata: { nested: true } }], total: 1 };

test("simultaneous record/member reads share only a token and URL, with independent result objects", async () => {
  const { api, calls } = await clientFixture();
  const first = api.listRecords("one", "task", "limit=200&offset=0");
  const second = api.listRecords("one", "task", "limit=200");
  const another = api.listRecords("two", "task", "limit=200&offset=0");
  const page = api.listRecords("one", "task", "limit=200&offset=200");
  assert.equal(calls.length, 3);
  calls.forEach(call => call.reply(recordBody));
  const [a, b] = await Promise.all([first, second, another, page]);
  a.records[0].metadata.nested = false;
  assert.equal(b.records[0].metadata.nested, true);
  const memberOne = api.listMembers("one"), memberTwo = api.listMembers("one");
  assert.equal(calls.length, 4);
  calls[3].reply({ members: [] });
  await Promise.all([memberOne, memberTwo]);
  const fresh = api.listMembers("one");
  assert.equal(calls.length, 5, "a completed response is not a persistent cache");
  calls[4].reply({ members: [] }); await fresh;
});

test("a shared content provider and its page reuse the same first record page", async () => {
  const { api, calls } = await clientFixture();
  const provider = api.listAllRecordsOfType("one", "content_topic");
  const screen = api.listRecords("one", "content_topic", "limit=200");
  assert.equal(calls.length, 1);
  calls[0].reply({ records: [{ ...recordBody.records[0], record_type: "content_topic" }], total: 1 });
  const [all, page] = await Promise.all([provider, screen]);
  assert.equal(all.length, 1); assert.equal(page.total, 1);
});

test("whole-type pagination counts only the first page and keeps exact-boundary termination", async () => {
  const { api, calls } = await clientFixture();
  const all = api.listAllRecordsOfType("one", "content_topic");
  const screen = api.listRecords("one", "content_topic", "limit=200");
  assert.equal(calls.length, 1);
  const rows = offset => Array.from({ length: 200 }, (_, i) => ({ ...recordBody.records[0], id: `synthetic-${offset + i}`, record_type: "content_topic" }));
  calls[0].reply({ records: rows(0), total: 400 });
  await turn();
  assert.equal(calls.length, 2);
  const query = new URLSearchParams(calls[1].path.split("?")[1]);
  assert.equal(query.get("count"), "none");
  assert.equal(query.get("offset"), "200");
  calls[1].reply({ records: rows(200), total: null });
  assert.equal((await all).length, 400);
  assert.equal((await screen).total, 400);
  assert.equal(calls.length, 2, "the first count avoids a third empty page at an exact boundary");
});

test("whole-type pagination stops if rows disappear after the first count", async () => {
  const { api, calls } = await clientFixture();
  const all = api.listAllRecordsOfType("one", "task");
  calls[0].reply({ records: Array.from({ length: 200 }, (_, i) => ({ ...recordBody.records[0], id: `synthetic-${i}` })), total: 9999 });
  await turn();
  assert.equal(calls.length, 5, "pages after the first count are read four at a time");
  const queries = calls.slice(1).map(call => new URLSearchParams(call.path.split("?")[1]));
  assert.deepEqual(queries.map(query => query.get("offset")), ["200", "1200", "2200", "3200"]);
  assert.ok(queries.every(query => query.get("limit") === "1000" && query.get("count") === "none"));
  calls.slice(1).forEach(call => call.reply({ records: [], total: null }));
  assert.equal((await all).length, 200);
  assert.equal(calls.length, 5, "a short page stops before the next group");
});

test("mutations break reuse before and after a save, without allowing old reads to evict new ones", async () => {
  const { api, calls } = await clientFixture();
  const oldRead = api.listMembers("one");
  const write = api.apiRequest("/api/v1/members", { token: "one", method: "PATCH", body: "{}" });
  const duringOne = api.listMembers("one"), duringTwo = api.listMembers("one");
  assert.equal(calls.length, 4, "reads while a save is pending do not coalesce");
  calls[1].reply({ saved: true }); await write;
  const fresh = api.listMembers("one");
  calls[0].reply({ members: [{ id: "old" }] }); await oldRead;
  const sameFresh = api.listMembers("one");
  assert.equal(calls.length, 5, "an old settlement cannot remove the replacement request");
  calls[2].reply({ members: [] }); calls[3].reply({ members: [] }); calls[4].reply({ members: [{ id: "new" }] });
  const [value] = await Promise.all([fresh, sameFresh, duringOne, duringTwo]);
  assert.equal(value.members[0].id, "new");
});

test("failures are retryable and generic, anonymous, and server requests are never coalesced", async () => {
  const { api, calls } = await clientFixture();
  const failedOne = api.listMembers("one"), failedTwo = api.listMembers("one");
  const failures = [failedOne, failedTwo].map(result => assert.rejects(result, error => error.code === "NO_ACCESS" && error.status === 403));
  calls[0].reply({ error: { code: "NO_ACCESS", message: "denied" } }, 403);
  await Promise.all(failures);
  const retry = api.listMembers("one"); calls[1].reply({ members: [] }); await retry;
  const independent = [api.apiRequest("/api/v1/development-notifications", { token: "one" }), api.apiRequest("/api/v1/development-notifications", { token: "one" }), api.listMembers(null), api.listMembers(null)];
  assert.equal(calls.length, 6);
  calls.slice(2).forEach(call => call.reply({ members: [] })); await Promise.all(independent);
  const server = await clientFixture(false);
  const serverCalls = [server.api.listMembers("one"), server.api.listMembers("one")];
  assert.equal(server.calls.length, 2);
  server.calls.forEach(call => call.reply({ members: [] })); await Promise.all(serverCalls);
});
