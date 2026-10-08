import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as zod from "zod";
import * as domain from "../lib/hr/domain.ts";
import * as hrTypes from "../lib/hr/types.ts";
const root = path.resolve(import.meta.dirname, "..");
class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
function harness({
  flag = true,
  access = true,
  role = "admin",
  rpcResults = {},
  tables = {},
  me = null,
} = {}) {
  const calls = [],
    env = { CRON_SECRET: "test-secret" },
    cache = new Map();
  let authenticated = 0;
  const db = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name in rpcResults) return rpcResults[name];
      return {
        data:
          name === "os_has_hr_access"
            ? access
            : name === "os_hr_my_employee_id"
              ? me
              : name === "os_hr_people"
                ? tables.people || []
                : name === "os_hr_me"
                  ? null
                  : null,
        error: null,
      };
    },
    from(name) {
      let rows = tables[name] || [];
      const q = {
        select() {
          return q;
        },
        order() {
          return q;
        },
        range(a, b) {
          rows = rows.slice(a, b + 1);
          return q;
        },
        eq(k, v) {
          rows = rows.filter((r) => r[k] === v);
          return q;
        },
        gte() {
          return q;
        },
        lte() {
          return q;
        },
        limit(n) {
          rows = rows.slice(0, n);
          return q;
        },
        maybeSingle: async () => ({ data: rows[0] || null, error: null }),
        then(resolve, reject) {
          return Promise.resolve({ data: rows, error: null }).then(
            resolve,
            reject,
          );
        },
      };
      return q;
    },
    storage: {
      from: () => ({
        createSignedUploadUrl: async () => {
          calls.push({ name: "upload" });
          return { data: { token: "test-upload" }, error: null };
        },
        createSignedUrl: async () => {
          calls.push({ name: "signed-read" });
          return {
            data: { signedUrl: "https://storage.example.test/signed" },
            error: null,
          };
        },
      }),
    },
  };
  const actor = {
    id: "00000000-0000-4000-8000-000000000001",
    role,
    supabase: db,
  };
  const overrides = {
    zod: zod,
    "next/server": { NextResponse: Response },
    "@/lib/http": {
      ApiError,
      apiErrorResponse: (e) =>
        Response.json(
          { error: { code: e.code || "ERROR", message: e.message } },
          { status: e.status || 500 },
        ),
    },
    "@/lib/hr/gate": { hrWorkspaceEnabled: () => flag },
    "@/lib/hr/domain": domain,
    "@/lib/hr/types": hrTypes,
    "@/lib/server/auth": {
      authenticateRequest: async () => {
        authenticated++;
        return actor;
      },
      safeSecretMatch: (a, b) => a === b,
    },
    "./auth": {
      authenticateRequest: async () => {
        authenticated++;
        return actor;
      },
    },
    "@/lib/supabase/server": { createServiceSupabase: () => db },
    "./account-security": {
      getInitialPassword: () => {
        throw new Error("Unexpected account creation");
      },
    },
    "node:crypto": { randomUUID: () => id(9) },
  };
  function load(file) {
    file = path.resolve(root, file.replace(/\.ts\.ts$/, ".ts"));
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} };
    cache.set(file, mod.exports);
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    vm.runInNewContext(code, {
      module: mod,
      exports: mod.exports,
      require: (key) => {
        if (key in overrides) return overrides[key];
        if (key.startsWith("@/")) return load(key.slice(2) + ".ts");
        if (key.startsWith("."))
          return load(path.resolve(path.dirname(file), key) + ".ts");
        throw new Error("Unexpected import " + key);
      },
      Request,
      Response,
      URL,
      URLSearchParams,
      Buffer,
      Uint8Array,
      Date,
      Intl,
      Set,
      Map,
      AbortSignal,
      process: { env },
    });
    return mod.exports;
  }
  return { load, calls, actor, env, authCount: () => authenticated };
}
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function call(h, method, route, body) {
  const [pathname] = route.split("?");
  return h
    .load("app/api/v1/hr/[...path]/route.ts")
    [method](
      new Request("https://example.test/api/v1/hr/" + route, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      { params: Promise.resolve({ path: pathname.split("/") }) },
    );
}
test("HR rollout is closed before authentication and database reads", async () => {
  const h = harness({ flag: false });
  assert.equal((await call(h, "GET", "workspace")).status, 404);
  assert.equal(h.authCount(), 0);
  assert.equal(h.calls.length, 0);
});
test("HR member cannot read management data or save documents, holidays, imports", async () => {
  for (const [method, url, body] of [
    ["GET", "workspace"],
    ["GET", "documents"],
    ["POST", "legacy-import", {}],
    ["POST", "holidays", {}],
    ["PATCH", "documents", {}],
  ]) {
    const h = harness({ access: false, role: "member" });
    assert.equal((await call(h, method, url, body)).status, 403, url);
    assert.deepEqual(
      h.calls.map((x) => x.name),
      ["os_has_hr_access"],
    );
  }
});
test("HR self service uses self RPC and gracefully handles a non-worker", async () => {
  const h = harness({ access: false, role: "member" }),
    r = await call(h, "GET", "me/leave");
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).data.employees, []);
  assert.ok(h.calls.some((x) => x.name === "os_hr_me"));
});
test("HR validates real dates, unknown fields and approval versions before mutations", async () => {
  const h = harness();
  for (const body of [
    { person: id(3), type: "annual", start: "2026-02-30", end: "2026-03-01" },
    {
      person: id(3),
      type: "annual",
      start: "2026-12-23",
      end: "2026-12-28",
      actor: id(1),
    },
  ])
    assert.equal((await call(h, "POST", "leave-requests", body)).status, 400);
  assert.equal(
    (
      await call(h, "POST", `leave-requests/${id(2)}/decision`, {
        version: 0,
        decision: "approved",
      })
    ).status,
    400,
  );
  assert.ok(
    !h.calls.some(
      (x) =>
        x.name === "os_hr_request_leave" || x.name === "os_hr_decide_leave",
    ),
  );
});
test("HR approved mutation carries version; database conflict is 409 and sanitized", async () => {
  const h = harness({
      rpcResults: {
        os_hr_decide_leave: {
          data: null,
          error: { message: "VERSION_CONFLICT private database details" },
        },
      },
    }),
    r = await call(h, "POST", `leave-requests/${id(2)}/decision`, {
      version: 3,
      decision: "approved",
    });
  assert.equal(r.status, 409);
  assert.equal(h.calls.at(-1).args.p_version, 3);
  assert.doesNotMatch(
    JSON.stringify(await r.json()),
    /private database details/,
  );
});
test("HR non-operator cannot approve through a self-service URL", async () => {
  const h = harness({ access: false, role: "member" });
  assert.equal(
    (
      await call(h, "POST", `leave-requests/${id(2)}/decision`, {
        version: 1,
        decision: "approved",
      })
    ).status,
    403,
  );
  assert.ok(!h.calls.some((x) => x.name === "os_hr_decide_leave"));
});
test("HR calendar requires both bounds; malformed JSON and large bodies fail safely", async () => {
  const h = harness();
  assert.equal(
    (await call(h, "GET", "leave-requests?calendar=true")).status,
    400,
  );
  const { hrJson } = h.load("lib/server/hr.ts");
  await assert.rejects(
    hrJson(new Request("https://example.test", { method: "POST", body: "{" })),
    (e) => e.code === "INVALID_JSON",
  );
  await assert.rejects(
    hrJson(
      new Request("https://example.test", {
        method: "POST",
        body: "a".repeat(64001),
      }),
    ),
    (e) => e.status === 413,
  );
});
test("HR proof uploads constrain owner, size and MIME before signed URL", async () => {
  const h = harness({
      access: false,
      role: "member",
      me: id(3),
      tables: { os_hr_employees: [{ id: id(3) }] },
    }),
    { hrUpload } = h.load("lib/server/hr-files.ts"),
    actor = { ...h.actor, hrAccess: false };
  await assert.rejects(
    hrUpload(actor, {
      purpose: "document",
      employee: id(3),
      size: 100,
      mime: "application/pdf",
    }),
    (e) => e.status === 403,
  );
  await assert.rejects(
    hrUpload(actor, {
      purpose: "leave_proof",
      employee: id(4),
      size: 100,
      mime: "application/pdf",
    }),
    (e) => e.status === 403,
  );
  await assert.rejects(
    hrUpload(actor, {
      purpose: "leave_proof",
      employee: id(3),
      size: 10485761,
      mime: "application/pdf",
    }),
    (e) => e.status === 413,
  );
  await assert.rejects(
    hrUpload(actor, {
      purpose: "leave_proof",
      employee: id(3),
      size: 100,
      mime: "text/html",
    }),
  );
  assert.ok(!h.calls.some((x) => x.name === "upload"));
  const r = await hrUpload(actor, {
    purpose: "leave_proof",
    employee: id(3),
    size: 100,
    mime: "application/pdf",
  });
  assert.match(r.path, /^leave_proof\/.*\.pdf$/);
});
test("HR own proof and own paper letters require referenced paths and audit before signing", async () => {
  const file = `promotion_paper/${id(3)}/${id(9)}.pdf`;
  const h = harness({
    access: false,
    role: "member",
    me: id(3),
    tables: {
      os_hr_leave_promotions: [
        { id: id(6), hr_employee_id: id(3), paper_path: file },
      ],
    },
  });
  const { hrFileRead } = h.load("lib/server/hr-files.ts"),
    actor = { ...h.actor, hrAccess: false };
  await assert.rejects(
    hrFileRead(actor, `document/${id(3)}/${id(9)}.pdf`),
    (e) => e.status === 403,
  );
  await assert.rejects(
    hrFileRead(actor, "../private.pdf"),
    (e) => e.status === 400,
  );
  const result = await hrFileRead(actor, file);
  assert.equal(result.expiresIn, 60);
  assert.ok(
    h.calls.findIndex((x) => x.name === "os_hr_file_view") <
      h.calls.findIndex((x) => x.name === "signed-read"),
  );
});
test("HR holiday response validates provider status, completeness, year and combines same-day names", () => {
  const { parseHolidayResponse } = harness().load("lib/server/hr-holidays.ts");
  const data = {
    response: {
      header: { resultCode: "00" },
      body: {
        totalCount: 2,
        items: {
          item: [
            { locdate: 20261009, isHoliday: "Y", dateName: "한글날" },
            { locdate: 20261009, isHoliday: "Y", dateName: "가상 휴일" },
          ],
        },
      },
    },
  };
  assert.equal(parseHolidayResponse(data, 2026).length, 1);
  assert.match(parseHolidayResponse(data, 2026)[0].name, /한글날/);
  assert.throws(() => parseHolidayResponse(data, 2027));
  data.response.body.totalCount = 3;
  assert.throws(() => parseHolidayResponse(data, 2026));
  data.response.header.resultCode = "30";
  assert.throws(() => parseHolidayResponse(data, 2026));
});
test("HR cron authenticates before work, and flag-off never calls the database", async () => {
  const h = harness({ flag: false }),
    { GET } = h.load("app/api/v1/hr/cron/route.ts");
  assert.equal(
    (await GET(new Request("https://example.test/api/v1/hr/cron"))).status,
    401,
  );
  assert.equal(
    (
      await GET(
        new Request("https://example.test/api/v1/hr/cron", {
          headers: { authorization: "Bearer test-secret" },
        }),
      )
    ).status,
    200,
  );
  assert.equal(h.calls.length, 0);
});
