import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { validDay } from "../lib/team/dates.ts";

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function route({ authenticated = true, enabled = true, rpcError = null, rows = [] } = {}) {
  const calls = [];
  const db = {
    rpc: async (name, args) => { calls.push({ name, args }); return { data: rows, error: rpcError }; },
    from: () => { throw new Error("HR tables must not be queried directly"); },
  };
  const modules = {
    "next/server": { NextResponse: Response },
    "@/lib/http": { ApiError, apiErrorResponse: error => Response.json({ error: { code: error.code, message: error.message } }, { status: error.status ?? 500 }) },
    "@/lib/hr/gate": { hrWorkspaceEnabled: () => enabled },
    "@/lib/server/auth": { authenticateRequest: async () => {
      if (!authenticated) throw new ApiError(401, "INVALID_SESSION", "로그인 필요");
      return { type: "user", supabase: db };
    } },
    "@/lib/team/dates": { validDay },
  };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("../app/api/v1/hr/absences/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { exports, require: name => { assert.ok(name in modules, name); return modules[name]; }, Response, URL, Date });
  return { ...exports, calls };
}

const url = "http://localhost/api/v1/hr/absences?from=2026-10-11&to=2026-10-19";

test("team absence read uses only the authenticated bounded projection", async () => {
  const absences = [{ name: "팀원", start: "2026-10-12", end: "2026-10-12", part: "am" }];
  const api = route({ rows: absences });
  const response = await api.GET(new Request(url));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { absences });
  assert.deepEqual(JSON.parse(JSON.stringify(api.calls)), [{ name: "os_team_absences", args: { p_from: "2026-10-11", p_to: "2026-10-19" } }]);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("team absence read rejects invalid ranges before DB access", async () => {
  const api = route();
  for (const query of ["from=2026-10-19&to=2026-10-11", "from=2026-10-11&to=2027-01-20", "from=bad&to=2026-10-19"]) {
    assert.equal((await api.GET(new Request(`http://localhost/api/v1/hr/absences?${query}`))).status, 400);
  }
  assert.deepEqual(api.calls, []);
});

test("team absence read hides DB errors and does not query when unavailable", async () => {
  const failed = route({ rpcError: { message: "private HR database detail" } });
  const response = await failed.GET(new Request(url));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private HR database detail/);
  const signedOut = route({ authenticated: false });
  assert.equal((await signedOut.GET(new Request(url))).status, 401);
  assert.deepEqual(signedOut.calls, []);
  const disabled = route({ enabled: false });
  assert.deepEqual(await (await disabled.GET(new Request(url))).json(), { absences: [] });
  assert.deepEqual(disabled.calls, []);
});
