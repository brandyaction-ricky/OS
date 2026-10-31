import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

// Staff AI jobs reach the OS only through these two MCP tools (owner decision 2026-10-17, method B).
const compiled = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/server/mcp.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module: compiled, exports: compiled.exports, require: (name) => { if (name === "zod") return { z }; throw Error(name); }, URLSearchParams, encodeURIComponent });
const { MCP_TOOLS, callMcpTool } = compiled.exports;
const job = "11111111-1111-4111-8111-111111111111";
const lease = "22222222-2222-4222-8222-222222222222";

test("staff AI tools are listed and read-only listing is marked so", () => {
  const list = MCP_TOOLS.find((tool) => tool.name === "list_youtube_ai_jobs");
  const process = MCP_TOOLS.find((tool) => tool.name === "process_youtube_ai_job");
  assert.equal(list.annotations.readOnlyHint, true);
  assert.deepEqual([...process.inputSchema.properties.action.enum], ["claim", "complete", "fail"]);
});

test("tool calls go to the staff AI worker route with the key owner's identity", async () => {
  const calls = [];
  const fetchApi = async (path, init = {}) => { calls.push({ path, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null }); return { ok: true }; };
  await callMcpTool({ name: "list_youtube_ai_jobs", arguments: {} }, "org", fetchApi);
  await callMcpTool({ name: "process_youtube_ai_job", arguments: { action: "claim", job_id: job } }, "org", fetchApi);
  await callMcpTool({ name: "process_youtube_ai_job", arguments: { action: "complete", job_id: job, lease, model: "claude-opus-5-5", result: { plan: {}, pronunciation: { ready: true, issues: [] } }, report: { conclusion: "장면 12개 설계, 고칠 곳 없음" } } }, "org", fetchApi);
  assert.deepEqual(calls.map((call) => [call.path, call.method]), [
    ["/api/v1/content/youtube-automation/ai-jobs/worker", "GET"],
    ["/api/v1/content/youtube-automation/ai-jobs/worker", "POST"],
    ["/api/v1/content/youtube-automation/ai-jobs/worker", "POST"],
  ]);
  assert.deepEqual(calls[1].body, { action: "claim", jobId: job });
  assert.equal(calls[2].body.lease, lease);
  assert.equal(calls[2].body.model, "claude-opus-5-5");
  // 한눈에 보기 결론 먼저: the report goes through beside the result.
  assert.equal(calls[2].body.report.conclusion, "장면 12개 설계, 고칠 곳 없음");
});

test("malformed tool input is refused before reaching the OS", async () => {
  const fetchApi = async () => { throw Error("should not be called"); };
  await assert.rejects(callMcpTool({ name: "process_youtube_ai_job", arguments: { action: "approve", job_id: job } }, "org", fetchApi));
  await assert.rejects(callMcpTool({ name: "process_youtube_ai_job", arguments: { action: "claim", job_id: "not-a-uuid" } }, "org", fetchApi));
  await assert.rejects(callMcpTool({ name: "list_youtube_ai_jobs", arguments: { extra: 1 } }, "org", fetchApi));
});
