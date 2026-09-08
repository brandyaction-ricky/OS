import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as zod from "zod";

const adminId = "00577b9b-61bd-420b-9c6c-61353e270230";
const memberId = "7fc38867-c77f-4264-95d3-dae5ae579cfd";
const priorAdminId = "c94f904c-1d6a-4f04-b92d-e3cc9a9c556e";
const testPassword = "test-only-initial-123!";
const paths = {
  create: "../app/api/v1/members/accounts/route.ts",
  reset: "../app/api/v1/members/[id]/password-reset/route.ts",
};
const code = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name,
  ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
])));

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function setup(kind, options = {}) {
  const actor = { id: adminId, role: "admin" };
  const target = {
    id: memberId, display_name: "QA 구성원", email: "qa-member@example.com", is_active: true,
    must_change_password: false, password_reset_at: "2026-09-01T00:00:00Z", password_reset_by: priorAdminId,
    ...options.target,
  };
  const originalTarget = structuredClone(target);
  const events = [];
  let updates = 0;
  const fail = (message) => ({ message });
  const service = {
    from(table) {
      const filters = [];
      let action = "read", fields;
      const execute = () => {
        if (action === "update") {
          updates += 1;
          events.push({ kind: "profile-update", fields: structuredClone(fields) });
          const error = options.stateError && updates === 1 ? fail("state unavailable")
            : options.rollbackError && updates > 1 ? fail("rollback unavailable") : null;
          if (!error && filters.every(([key, value]) => target[key] === value)) Object.assign(target, fields);
          return { data: null, error };
        }
        if (action === "upsert") {
          events.push({ kind: "profile-upsert", fields: structuredClone(fields) });
          return { data: null, error: options.upsertError ? fail("upsert unavailable") : null };
        }
        events.push({ kind: "lookup", table });
        if (table === "os_profiles") return {
          data: kind === "create" ? options.existingProfile ?? null : options.missingTarget ? null : structuredClone(target),
          error: options.lookupError ? fail("profile unavailable") : null,
        };
        assert.equal(table, "os_records");
        return { data: options.directory ?? null, error: options.directoryError ? fail("directory unavailable") : null };
      };
      const builder = {
        select() { return builder; }, or() { return builder; }, limit() { return builder; },
        contains() { return builder; }, is() { return builder; },
        eq(key, value) { filters.push([key, value]); return builder; },
        update(input) { action = "update"; fields = input; return builder; },
        upsert(input) { action = "upsert"; fields = input; return builder; },
        maybeSingle() { return Promise.resolve().then(execute); },
        then(resolve, reject) { return Promise.resolve().then(execute).then(resolve, reject); },
      };
      return builder;
    },
    auth: { admin: {
      async createUser(input) {
        events.push({ kind: "auth-create", input: structuredClone(input) });
        return { data: { user: { id: memberId } }, error: null };
      },
      async updateUserById(id, input) {
        events.push({ kind: "auth-reset", id, input: structuredClone(input) });
        options.onReset?.(target);
        return { error: options.resetError ? fail("reset unavailable") : null };
      },
      async deleteUser(id) { events.push({ kind: "auth-delete", id }); return { error: null }; },
    } },
  };
  const modules = {
    "next/server": { NextResponse: Response }, zod,
    "@/lib/company-roster": { COMPANY_ROSTER: [{ name: "QA 구성원", affiliation: "QA", roles: ["검수"] }] },
    "@/lib/server/auth": { authenticateRequest: async (request) => {
      if (!request.headers.has("authorization")) throw new ApiError(401, "AUTH_REQUIRED", "로그인이 필요합니다.");
      return actor;
    } },
    "@/lib/http": { ApiError, parseJson: (request) => request.json(), apiErrorResponse: (error) => Response.json({ error: { code: error.code ?? "INTERNAL_ERROR", message: error.message } }, { status: error.status ?? 500 }) },
    "@/lib/server/account-security": {
      getInitialPassword: () => testPassword,
      writeSecurityAudit: async (input) => { events.push({ kind: "audit", ...structuredClone(input) }); },
    },
    "@/lib/supabase/server": { createServiceSupabase: () => service },
  };
  const commonJsModule = { exports: {} };
  runInNewContext(`(function(require, module, exports) { ${code[kind]}\n})`, { Response, console })((key) => {
    assert.ok(key in modules, `Unexpected module ${key}`);
    return modules[key];
  }, commonJsModule, commonJsModule.exports);
  return { route: commonJsModule.exports.POST, actor, target, originalTarget, events };
}

const request = (body = {}, authenticated = true) => new Request("https://os.example/api/v1/members", {
  method: "POST", headers: { "content-type": "application/json", ...(authenticated ? { authorization: "Bearer test-session" } : {}) },
  body: JSON.stringify(body),
});
const input = { legalName: "QA 실명", nickname: "QA 구성원", email: "QA-member@example.com" };
const params = (id = memberId) => ({ params: Promise.resolve({ id }) });

test("account creation stops before Auth writes when profile or directory verification fails", async () => {
  for (const [option, code] of [["lookupError", "MEMBER_ACCOUNT_LOOKUP_FAILED"], ["directoryError", "MEMBER_DIRECTORY_LOOKUP_FAILED"]]) {
    const { route, events } = setup("create", { [option]: true });
    const response = await route(request(input));
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error.code, code);
    assert.ok(events.every((event) => event.kind === "lookup"));
  }
});

test("account creation keeps verified directory values, least privilege and an audit record", async () => {
  const { route, events } = setup("create", { directory: { team: "QA 팀", brand: "QA 브랜드", metadata: { roles: ["검수 담당"], onboarding: { handbook: true } } } });
  const response = await route(request(input));
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.account.email, "qa-member@example.com");
  assert.equal(body.account.mustChangePassword, true);
  assert.ok(!JSON.stringify(body).includes(testPassword));
  const profile = events.find((event) => event.kind === "profile-upsert").fields;
  assert.equal(profile.role, "member");
  assert.equal(profile.finance_access, false);
  assert.equal(profile.team, "QA 팀");
  assert.deepEqual(profile.roles, ["검수 담당"]);
  assert.deepEqual(profile.onboarding, { handbook: true, account: true });
  assert.ok(events.findIndex((event) => event.kind === "auth-create") > events.findIndex((event) => event.table === "os_records"));
  assert.equal(events.at(-1).action, "account.created");
});

test("account creation rejects duplicates and removes new Auth user if its profile cannot be saved", async () => {
  const duplicate = setup("create", { existingProfile: { id: memberId } });
  assert.equal((await duplicate.route(request(input))).status, 409);
  assert.ok(!duplicate.events.some((event) => event.kind === "auth-create"));
  const failed = setup("create", { upsertError: true });
  assert.equal((await failed.route(request(input))).status, 400);
  assert.deepEqual(failed.events.filter((event) => event.kind === "auth-delete"), [{ kind: "auth-delete", id: memberId }]);
});

test("account management requires authentication and administrator role before database access", async () => {
  for (const kind of ["create", "reset"]) {
    const { route, actor, events } = setup(kind);
    assert.equal((await route(request(input, false), params())).status, 401);
    actor.role = "member";
    assert.equal((await route(request(input), params())).status, 403);
    assert.deepEqual(events, []);
  }
});

test("password reset rejects invalid IDs, self reset and disabled targets without Auth writes", async () => {
  const invalid = setup("reset");
  assert.equal((await invalid.route(request(), params("invalid"))).status, 400);
  assert.equal((await invalid.route(request(), params(adminId))).status, 400);
  assert.deepEqual(invalid.events, []);
  const disabled = setup("reset", { target: { is_active: false } });
  assert.equal((await disabled.route(request(), params())).status, 400);
  assert.ok(!disabled.events.some((event) => event.kind === "auth-reset"));
});

test("password reset distinguishes lookup failure from absent members and never changes either", async () => {
  for (const [options, expected] of [[{ lookupError: true }, 500], [{ missingTarget: true }, 404]]) {
    const { route, events, target, originalTarget } = setup("reset", options);
    assert.equal((await route(request(), params())).status, expected);
    assert.deepEqual(target, originalTarget);
    assert.ok(events.every((event) => event.kind === "lookup"));
  }
});

test("failed Auth reset restores all previous reset state and does not report success", async () => {
  const { route, events, target, originalTarget } = setup("reset", { resetError: true });
  const response = await route(request(), params());
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "PASSWORD_RESET_FAILED");
  assert.deepEqual(target, originalTarget);
  assert.ok(!events.some((event) => event.kind === "audit"));
});

test("failed reset compensation preserves a newer reset or completed password change", async () => {
  for (const change of [
    { password_reset_at: "2099-01-01T00:00:00Z", password_reset_by: priorAdminId, must_change_password: true },
    { must_change_password: false },
  ]) {
    const { route, target } = setup("reset", { resetError: true, onReset: (profile) => Object.assign(profile, change) });
    assert.equal((await route(request(), params())).status, 400);
    for (const [key, value] of Object.entries(change)) assert.equal(target[key], value);
  }
});

test("password reset surfaces state recovery failure instead of claiming normal rollback", async () => {
  const { route, target } = setup("reset", { resetError: true, rollbackError: true });
  const response = await route(request(), params());
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error.code, "PASSWORD_RESET_RECOVERY_FAILED");
  assert.equal(target.must_change_password, true);
});

test("successful reset enforces a new password change and writes an audit without returning password", async () => {
  const { route, events, target } = setup("reset");
  const response = await route(request(), params());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.reset, true);
  assert.equal(body.member.mustChangePassword, true);
  assert.equal(target.password_reset_by, adminId);
  assert.equal(target.must_change_password, true);
  assert.ok(!JSON.stringify(body).includes(testPassword));
  assert.equal(events.at(-1).action, "password.reset");
});
