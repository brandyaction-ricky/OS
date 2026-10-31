import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// 대표 결정 2026-10-31 (41a8387c): a step screen of someone else's project asks before a change; 「아니요」 sends nothing.
function loadClient(calls) {
  const exports = {};
  const source = readFileSync(new URL("../lib/api-client.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const fetch = async (path, init) => { calls.push(`${init.method ?? "GET"} ${path}`); return Response.json({ ok: true }); };
  runInNewContext(code, { exports, Headers, Response, FormData, fetch, structuredClone, window: undefined, require: () => new Proxy({}, { get: () => () => undefined }) });
  return exports;
}

test("a declined change never leaves the browser; reads and allowed changes do", async () => {
  const calls = [];
  const { apiRequest, setEditGuard } = loadClient(calls);
  const asked = [];
  setEditGuard(path => { asked.push(path); return path.includes("/feedback"); });
  await apiRequest("/api/v1/content/youtube/projects/p1");
  await assert.rejects(apiRequest("/api/v1/content/youtube/projects/p1/stages/plan", { method: "PATCH", body: "{}" }), error => error.code === "EDIT_DECLINED" && error.message.includes("메모"));
  await apiRequest("/api/v1/content/youtube/projects/p1/feedback", { method: "POST", body: "{}" });
  setEditGuard(null);
  await apiRequest("/api/v1/content/youtube/projects/p1/stages/plan", { method: "PATCH", body: "{}" });
  assert.deepEqual(asked, ["/api/v1/content/youtube/projects/p1/stages/plan", "/api/v1/content/youtube/projects/p1/feedback"]);
  assert.deepEqual(calls, ["GET /api/v1/content/youtube/projects/p1", "POST /api/v1/content/youtube/projects/p1/feedback", "PATCH /api/v1/content/youtube/projects/p1/stages/plan"]);
});
