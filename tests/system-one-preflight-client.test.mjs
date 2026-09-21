import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { checkPreflight } from "../lib/system-one-preflight-client.ts";

const selection = { source: { id: "synthetic-source", expectedVersion: 1 }, criteria: [{ id: "synthetic-criterion", expectedVersion: 2 }] };
const signal = new AbortController().signal;
test("preflight client uses only the same-origin read API and existing session", async () => {
  const result = await checkPreflight("synthetic-token", selection, signal, async (url, options) => {
    assert.equal(url, "/api/v1/system-one/preflight");
    assert.equal(options.headers.authorization, "Bearer synthetic-token");
    assert.equal(options.method, "POST");
    assert.equal(options.cache, "no-store");
    assert.equal(options.signal, signal);
    assert.deepEqual(JSON.parse(options.body), selection);
    return Response.json({ status: "ready", policyStatus: "unverified", judgment: null, executionAllowed: false });
  });
  assert.match(result, /읽기·버전 확인 완료/);
});
test("preflight client rejects unexpected successes and projects only safe failure messages", async () => {
  for (const [body, status, expected] of [
    [{ status: "ready", executionAllowed: true }, 200, /예상하지 못한/],
    [{ status: "stopped", code: "stale", secret: "PRIVATE" }, 409, /버전이 다릅니다/],
    [{ status: "stopped", code: "unavailable", title: "PRIVATE" }, 404, /권한이 없을/],
    [{ status: "stopped", code: "toString", error: "PRIVATE" }, 500, /예상하지 못한/],
  ]) {
    const result = await checkPreflight("synthetic-token", selection, signal, async () => Response.json(body, { status }));
    assert.match(result, expected);
    assert.doesNotMatch(result, /PRIVATE/);
  }
});
test("technical QA page reuses the server-side DEV gate and has no mock fallback", async () => {
  const page = await readFile(new URL("../app/(os)/knowledge/preflight/page.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(!canUseSystemOnePreflight\(process.env\)\) notFound\(\)/);
  assert.match(page, /force-dynamic/);
  const client = await readFile(new URL("../components/system-one-preflight-check.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(client, /localStorage|sessionStorage|console\.|createDocument|service_role/);
});
