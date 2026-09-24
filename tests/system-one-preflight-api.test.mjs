import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { canUseSystemOnePreflight } from "../lib/system-one-preflight-gate.ts";

const dev = "a".repeat(20), production = "b".repeat(20);
const environment = (patch = {}) => ({
  NODE_ENV: "development", OS_ENVIRONMENT: "development", NEXT_PUBLIC_DEMO_MODE: "false",
  SYSTEM_ONE_PREFLIGHT_ENABLED: "true", SYSTEM_ONE_DEV_SUPABASE_REF: dev,
  SYSTEM_ONE_PRODUCTION_SUPABASE_REF: production, NEXT_PUBLIC_SUPABASE_URL: `https://${dev}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-public-key", ...patch,
});
test("preflight requires explicit DEV configuration and accepts verified Preview shape", () => {
  assert.equal(canUseSystemOnePreflight({}), false);
  assert.equal(canUseSystemOnePreflight(environment()), true);
  assert.equal(canUseSystemOnePreflight(environment({ NODE_ENV: "production", OS_ENVIRONMENT: "qa", VERCEL_ENV: "preview" })), true);
  for (const patch of [
    { SYSTEM_ONE_PREFLIGHT_ENABLED: undefined }, { SYSTEM_ONE_PREFLIGHT_ENABLED: "false" },
    { OS_ENVIRONMENT: "production" }, { OS_ENVIRONMENT: "local" }, { OS_ENVIRONMENT: "custom" },
    { NEXT_PUBLIC_DEMO_MODE: "true" }, { NEXT_PUBLIC_DEMO_MODE: undefined },
    { NODE_ENV: "production" }, { NODE_ENV: "test" },
    { VERCEL: "1" }, { VERCEL_URL: "synthetic.vercel.app" },
    { VERCEL_ENV: "production" }, { VERCEL_ENV: "development" },
    { VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "production" },
    { VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "custom" },
    { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "main" },
    { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "refs/heads/master" },
  ]) assert.equal(canUseSystemOnePreflight(environment(patch)), false, JSON.stringify(patch));
});
test("DEV binding rejects missing, identical, malformed and mismatched project identities", () => {
  for (const patch of [
    { SYSTEM_ONE_DEV_SUPABASE_REF: "" }, { SYSTEM_ONE_PRODUCTION_SUPABASE_REF: "" },
    { SYSTEM_ONE_PRODUCTION_SUPABASE_REF: dev }, { SYSTEM_ONE_DEV_SUPABASE_REF: "A".repeat(20) },
    { NEXT_PUBLIC_SUPABASE_URL: `https://${production}.supabase.co` },
    { SUPABASE_URL: `https://${production}.supabase.co` },
    { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" },
    { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-fallback" },
  ]) assert.equal(canUseSystemOnePreflight(environment(patch)), false);
  for (const url of [
    `http://${dev}.supabase.co`, `https://${dev}.supabase.co.evil.example`,
    `https://${dev}.supabase.co:443`, `https://user@${dev}.supabase.co`,
    `https://${dev}.supabase.co/path`, `https://${dev}.supabase.co?x=1`, `https://${dev}.supabase.co#x`,
  ]) assert.equal(canUseSystemOnePreflight(environment({ NEXT_PUBLIC_SUPABASE_URL: url })), false);
  assert.equal(canUseSystemOnePreflight(environment({ NEXT_PUBLIC_SUPABASE_URL: `https://${dev}.supabase.co/` })), true);
});
test("known external integration credentials close this endpoint without printing values", () => {
  for (const key of [
    "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET",
    "YOUTUBE_API_KEY", "YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_TOKEN_ENCRYPTION_KEY",
    "META_ADS_ACCESS_TOKEN", "GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN", "GITHUB_TOKEN", "GH_TOKEN", "OS_PUSH_SECRET", "OS_AGENT_TOKEN",
  ]) assert.equal(canUseSystemOnePreflight(environment({ [key]: "synthetic-only" })), false, key);
});

const source = await readFile(new URL("../app/api/v1/system-one/preflight/route.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const input = { source: { id: "synthetic-source", expectedVersion: 1 }, criteria: [{ id: "synthetic-criterion", expectedVersion: 2 }] };
const at = "2026-01-01T00:00:00.000Z";
function harness(options = {}) {
  const calls = [];
  const compiledModule = { exports: {} };
  const privateFields = { title: "PRIVATE_TITLE", content_md: "PRIVATE_BODY", owner_id: "PRIVATE_OWNER", fingerprint: "PRIVATE_FINGERPRINT" };
  const modules = {
    "next/server": { NextResponse: Response },
    "@/lib/system-one-preflight-gate": { canUseSystemOnePreflight },
    "@/lib/server/system-one-user-source": { createSystemOneUserDocumentSource(request) {
      calls.push("source"); assert.equal(request.headers.get("authorization"), "Bearer synthetic-user"); return { synthetic: true };
    } },
    "@/lib/server/system-one-document-source": { async loadSystemOneDocumentBundle(value, deps) {
      calls.push("load"); assert.deepEqual(JSON.parse(JSON.stringify(value)), input); assert.equal(deps.synthetic, true);
      if (options.throws) throw new Error("PRIVATE_DATABASE_ERROR");
      return options.result ?? { status: "ready", bundle: {
        checkedAt: at, source: { id: "synthetic-source", current_version: 1, ...privateFields },
        criteria: [{ id: "synthetic-criterion", current_version: 2, ...privateFields }], principal: { id: "PRIVATE_USER" },
      } };
    } },
  };
  runInNewContext(code, { module: compiledModule, exports: compiledModule.exports,
    process: { env: options.env ?? environment() }, Uint8Array, TextDecoder,
    require(name) { assert.ok(Object.hasOwn(modules, name), name); return modules[name]; },
  });
  const request = (body = JSON.stringify(input), patch = {}) => new Request("http://synthetic.local/api/v1/system-one/preflight", {
    method: "POST", headers: { authorization: "Bearer synthetic-user", "content-type": "application/json", ...patch }, body,
  });
  return { POST: compiledModule.exports.POST, calls, request };
}
async function checkStopped(response, status, expectedCode) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Authorization");
  assert.deepEqual(await response.json(), { status: "stopped", code: expectedCode });
}
test("disabled and production routes return 404 before authentication or body reads", async () => {
  for (const env of [{}, environment({ OS_ENVIRONMENT: "production" }), environment({ GITHUB_TOKEN: "synthetic" })]) {
    const h = harness({ env });
    await checkStopped(await h.POST(h.request()), 404, "not_enabled");
    assert.deepEqual(h.calls, []);
  }
});
test("missing and agent tokens stop before the user source is created", async () => {
  for (const authorization of ["", "Basic synthetic", "Bearer bos_pat_synthetic", "Bearer x y"]) {
    const h = harness();
    await checkStopped(await h.POST(h.request(undefined, { authorization })), 401, "authentication_failed");
    assert.deepEqual(h.calls, []);
  }
});
test("media type and malformed JSON are rejected without document calls", async () => {
  const h = harness();
  await checkStopped(await h.POST(h.request("{}", { "content-type": "text/plain" })), 415, "invalid_input");
  await checkStopped(await h.POST(h.request("{")), 400, "invalid_input");
  await checkStopped(await h.POST(h.request("{}", { "content-length": "-1" })), 400, "invalid_input");
  assert.deepEqual(h.calls, []);
});
test("body cap cannot be bypassed by absent or dishonest Content-Length", async () => {
  for (const patch of [{}, { "content-length": "1" }, { "content-length": "4097" }]) {
    const h = harness();
    await checkStopped(await h.POST(h.request("한".repeat(1400), patch)), 413, "input_too_large");
    assert.deepEqual(h.calls, []);
  }
});
test("streamed overflow and invalid UTF-8 fail closed before source creation", async () => {
  for (const [chunks, status, error] of [
    [[new Uint8Array(3000), new Uint8Array(2000)], 413, "input_too_large"],
    [[new Uint8Array([0xff, 0xfe])], 400, "invalid_input"],
  ]) {
    const h = harness();
    const body = new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } });
    const request = new Request("http://synthetic.local", { method: "POST", headers: { authorization: "Bearer synthetic-user", "content-type": "application/json" }, body, duplex: "half" });
    await checkStopped(await h.POST(request), status, error);
    assert.deepEqual(h.calls, []);
  }
});
test("success projects only metadata and explicitly does not claim judgment or policy verification", async () => {
  const h = harness();
  const response = await h.POST(h.request(undefined, { "content-type": "application/json; charset=utf-8" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const result = await response.json();
  assert.deepEqual(result, { status: "ready", policyStatus: "unverified", judgment: null, executionAllowed: false, checkedAt: at,
    documents: [{ role: "source", id: "synthetic-source", version: 1, state: "head_verified" }, { role: "criterion", id: "synthetic-criterion", version: 2, state: "head_verified" }] });
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  assert.deepEqual(h.calls, ["source", "load"]);
});
test("all loader failures map to redacted HTTP statuses", async () => {
  for (const [code, status] of Object.entries({ invalid_input: 400, authentication_failed: 401, unavailable: 404, invalid_metadata: 422, stale: 409, read_failed: 503 })) {
    const h = harness({ result: { status: "stopped", code, extra: "PRIVATE" } });
    await checkStopped(await h.POST(h.request()), status, code);
  }
  const h = harness({ throws: true });
  await checkStopped(await h.POST(h.request()), 503, "read_failed");
});
