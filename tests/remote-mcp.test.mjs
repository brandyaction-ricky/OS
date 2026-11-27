import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import crypto from "node:crypto";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("remote MCP route exposes the five guarded knowledge tools", async () => {
  const [route, tools] = await Promise.all([
    read("app/api/mcp/route.ts"),
    read("lib/server/mcp.ts"),
  ]);
  for (const name of ["search_knowledge", "get_document", "create_document", "edit_document", "delete_document"]) {
    assert.match(tools, new RegExp(`name: "${name}"`));
  }
  assert.match(route, /protocolVersion = "2025-06-18"/);
  assert.match(route, /Bearer bos_pat_/);
  assert.match(route, /instructions:/);
  assert.match(tools, /z\.literal\(true\)/);
  assert.match(tools, /status: "draft"/);
  assert.doesNotMatch(route, /bos_pat_[A-Za-z0-9_-]{16,}/);
  assert.doesNotMatch(tools, /bos_pat_[A-Za-z0-9_-]{16,}/);
});

test("a new MCP session is told to read the operating canon first, by the id the server looks up", async () => {
  const { default: ts } = await import("typescript");
  const zod = await import("zod");
  const { runInNewContext } = await import("node:vm");
  const code = ts.transpileModule(await read("app/api/mcp/route.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const route = (rows) => {
    const queries = [];
    const chain = { select: () => chain, eq: (k, v) => (queries.push([k, v]), chain), is: () => chain, limit: () => Promise.resolve({ data: rows, error: null }) };
    const mod = { exports: {} };
    runInNewContext(code, { module: mod, exports: mod.exports, URL, Response, process: { env: {} },
      require: (id) => ({ "next/server": { NextResponse: Response }, zod, "@/lib/server/mcp": { MCP_TOOLS: [], callMcpTool() {} }, "node:crypto": crypto,
        "@/lib/supabase/server": { createServiceSupabase: () => ({ from: () => chain }) } })[id] });
    return { POST: mod.exports.POST, queries };
  };
  const init = async (r) => (await (await r.POST(new Request("http://localhost/api/mcp", { method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }) }))).json()).result.instructions;
  const found = route([{ id: "11111111-2222-4333-8444-555555555555" }]);
  const text = await init(found);
  assert.match(text, /^새 세션은 다른 일보다 먼저 get_document\(document_id: "11111111-2222-4333-8444-555555555555"\)로 「BRANDYACTION AI 에이전트 운영 정본 — OS ONLY」/);
  assert.match(text, /읽었다고 말하지 마세요/);
  assert.match(text, /list_skills/);
  assert.deepEqual(found.queries, [["title", "BRANDYACTION AI 에이전트 운영 정본 — OS ONLY"], ["status", "canonical"]]);
  // Two matches, or none, never point a session at a guessed document.
  for (const rows of [[], [{ id: "a" }, { id: "b" }]]) {
    const fallback = await init(route(rows));
    assert.match(fallback, /search_knowledge로 「BRANDYACTION AI 에이전트 운영 정본 — OS ONLY」을 찾아/);
    assert.doesNotMatch(fallback, /document_id:/);
  }
});

test("tools/call works on a bare /api/mcp URL: the organization comes from the key", async () => {
  const { default: ts } = await import("typescript");
  const zod = await import("zod");
  const { runInNewContext } = await import("node:vm");
  const code = ts.transpileModule(await read("app/api/mcp/route.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const sha = (v) => crypto.createHash("sha256").update(v, "utf8").digest("hex");
  const orgs = { [sha("bos_pat_good")]: "11111111-2222-4333-8444-555555555555" };
  let key = "", calledWith = null;
  const chain = { select: () => chain, eq: (_k, v) => (key = v, chain), maybeSingle: async () => ({ data: orgs[key] ? { organization_id: orgs[key] } : null, error: null }) };
  const mod = { exports: {} };
  runInNewContext(code, { module: mod, exports: mod.exports, URL, Response, process: { env: {} },
    require: (id) => ({ "next/server": { NextResponse: Response }, zod, "node:crypto": crypto,
      "@/lib/server/mcp": { MCP_TOOLS: [], callMcpTool: async (params, org) => (calledWith = [params.name, org], { ok: true }) },
      "@/lib/supabase/server": { createServiceSupabase: () => ({ from: () => chain }) } })[id] });
  const call = async (url, auth) => (await mod.exports.POST(new Request(url, { method: "POST", headers: auth ? { authorization: auth } : {},
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_document", arguments: {} } }) }))).json();
  const ok = await call("http://localhost/api/mcp", "Bearer bos_pat_good");
  assert.equal(ok.result.isError, undefined);
  assert.deepEqual(calledWith, ["get_document", orgs[sha("bos_pat_good")]]);
  assert.equal((await call("http://localhost/api/mcp", "Bearer bos_pat_fake")).error.code, -32001);
  assert.equal((await call("http://localhost/api/mcp")).error.code, -32001);
  assert.equal((await call("http://localhost/api/mcp?key=bos_pat_good")).result.isError, undefined);
});
