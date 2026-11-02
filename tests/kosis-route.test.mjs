import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { ZodError } from "zod";
import { kosisInputSchema, KosisError } from "../lib/kosis.ts";
const require = createRequire(import.meta.url);
class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
function load(authenticateRequest, queryKosis) {
  const mod = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL("../app/api/v1/statistics/kosis/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const deps = {
    zod: { ZodError },
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/http": { ApiError, parseJson: request => request.json(), apiErrorResponse: error => Response.json({ error: { code: error.code, message: error.message } }, { status: error.status }) },
    "@/lib/server/auth": { authenticateRequest },
    "@/lib/kosis": { kosisInputSchema, KosisError, queryKosis },
  };
  runInNewContext(code, { exports: mod.exports, module: mod, process: { env: {} }, require: name => deps[name] ?? require(name) });
  return mod.exports.POST;
}
const request = body => new Request("http://localhost/api/v1/statistics/kosis", { method: "POST", body: JSON.stringify(body) });
test("statistics authentication fails before input or external calls", async () => {
  let queried = false;
  const post = load(async () => { throw new ApiError(401, "AUTH_REQUIRED", "로그인 필요"); }, async () => { queried = true; });
  const response = await post(request({ action: "search", query: "고용" }));
  assert.equal(response.status, 401); assert.equal(queried, false);
});
test("agent statistics requests require knowledge.read and reject unsafe inputs", async () => {
  let options; let queried = false;
  const post = load(async (_request, value) => { options = value; }, async () => { queried = true; });
  assert.equal((await post(request({ action: "search", query: "고용", url: "https://elsewhere" }))).status, 400);
  assert.equal(options.allowAgent, true); assert.equal(options.requiredAgentScope, "knowledge.read"); assert.equal(queried, false);
});
test("disconnected KOSIS returns a clear error and no invented demo data", async () => {
  const post = load(async () => {}, async () => { throw new KosisError(503, "KOSIS_NOT_CONFIGURED", "연결 필요"); });
  const response = await post(request({ action: "search", query: "고용" }));
  assert.equal(response.status, 503); assert.equal((await response.json()).error.code, "KOSIS_NOT_CONFIGURED");
});
