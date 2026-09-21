import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";
import * as documents from "../lib/server/system-one-document-source.ts";
import * as content from "../lib/server/system-one-content-source.ts";
async function compile(path, modules, globals = {}) {
  const code = ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const target = { exports: {} };
  runInNewContext(code, { module: target, exports: target.exports, Buffer, URL, ...globals,
    require(name) { assert.ok(Object.hasOwn(modules, name), name); return modules[name]; } });
  return target.exports;
}
const registryModule = await compile("../lib/server/system-one-registry.ts", { zod: { z }, "@/lib/server/system-one-document-source": documents });
const planning = await compile("../lib/server/system-one-planning.ts", { zod: { z },
  "@/lib/server/system-one-document-source": documents, "@/lib/server/system-one-content-source": content,
  "@/lib/server/system-one-registry": registryModule });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const md5 = text => createHash("md5").update(text).digest("hex");
const entry = "## 0. 기획 진입 계약\nUse `OS_ROLE: synthetic.context`.\n## Other\n`OS_ROLE: synthetic.unrelated`";
function harness() {
  const time = "2026-01-01T00:00:00.000Z";
  const row = (n, text) => ({ id: id(n), title: "Synthetic reference", content_md: text, status: "canonical", owner_id: id(1),
    team: "", brand: null, folder: "Synthetic", current_version: 1, content_hash: md5(text), updated_at: time });
  const registry = "### 9-2. 역할 → 원문 등록부\n| 역할키 | 대상 doc_id | 담당 범위 | 검색 별칭·옛 이름 |\n|---|---|---|---|\n" +
    `| \`youtube.planning\` | \`${id(3)}\` | Synthetic scope | Alias |\n| \`synthetic.context\` | \`${id(4)}\` | Synthetic context | Alias |`;
  const state = { reads: 0, onRead: () => {}, topic: { id: id(10), record_type: "content_topic", title: "Synthetic topic", description: "Synthetic",
    status: "draft", stage: "", brand: "브랜디액션", team: "", owner_id: id(1), source_url: null, metadata: {}, version: 1, updated_at: time, archived_at: null },
    rows: [row(2, registry), row(3, entry), row(4, "Synthetic context")] };
  const principal = { id: id(1), type: "user", active: true, mustChangePassword: false };
  const deps = {
    content: { authenticate: async () => ({ principal, readHead: async () => state.topic }) },
    documents: { authenticate: async () => ({ principal: { ...principal, role: "member", team: "" },
      readHeads: async ids => { state.reads++; state.onRead(); return state.rows.filter(row => ids.includes(row.id)); } }) },
  };
  return { state, deps, input: { id: id(10), expectedVersion: 1 }, registry: { id: id(2), expectedVersion: 1 } };
}
test("entry discovery ignores other sections and fenced examples", () => {
  assert.deepEqual(Array.from(planning.planningEntryRoles(entry)), ["synthetic.context"]);
  assert.equal(planning.planningEntryRoles("```md\n" + entry + "\n```"), null);
  assert.equal(planning.planningEntryRoles(entry + "\n" + entry), null);
  assert.equal(planning.planningEntryRoles("No contract"), null);
});
test("missing server registry configuration never falls back to production IDs", () => {
  assert.equal(planning.planningRegistryConfig({}), null);
  assert.equal(planning.planningRegistryConfig({ SYSTEM_ONE_REGISTRY_DOCUMENT_ID: id(2), SYSTEM_ONE_REGISTRY_DOCUMENT_VERSION: "0" }), null);
});
test("real reader composition follows entry refs and returns only observation summary", async () => {
  const h = harness(); const result = await planning.checkPlanningReferences(h.input, h.registry, h.deps);
  assert.equal(result.status, "ready"); assert.equal(result.referenceCount, 2);
  assert.equal(result.policyStatus, "unverified"); assert.equal(result.executionAllowed, false);
  assert.equal(result.judgment, null); assert.equal(JSON.stringify(result).includes("content_md"), false);
});
for (const [name, change, code] of [
  ["other brand", s => { s.topic.brand = "Synthetic other brand"; }, "unsupported_context"],
  ["other owner", s => { s.topic.owner_id = id(9); }, "unavailable"],
  ["missing entry reference", s => { s.rows.pop(); }, "unavailable"],
  ["draft reference", s => { s.rows[2].status = "draft"; }, "approval_required"],
  ["material change during read", s => { s.onRead = () => { s.topic.description = "Changed"; }; }, "stale"],
]) test(`planning stops on ${name}`, async () => {
  const h = harness(); change(h.state); assert.equal((await planning.checkPlanningReferences(h.input, h.registry, h.deps)).code, code);
});
async function routeHarness({ enabled = true, configured = true, result, throws = false } = {}) {
  let calls = 0;
  const api = await compile("../app/api/v1/system-one/planning/route.ts", {
    "next/server": { NextResponse: Response }, "@/lib/system-one-preflight-gate": { canUseSystemOnePreflight: () => enabled },
    "@/lib/server/system-one-planning": { planningRegistryConfig: () => configured ? { id: id(2), expectedVersion: 1 } : null,
      checkPlanningReferences: async () => { calls++; if (throws) throw new Error("PRIVATE"); return result ?? {
        status: "ready", source: { id: id(10), version: 1 }, registryVersion: 1, referenceCount: 2, privateBody: "PRIVATE" }; } },
    "@/lib/server/system-one-user-content-source": { createSystemOneUserContentSource: () => ({}) },
    "@/lib/server/system-one-user-source": { createSystemOneUserDocumentSource: () => ({}) },
  }, { process: { env: {} } });
  const request = (query = `id=${id(10)}&version=1`, auth = "Bearer synthetic") => new Request(`https://synthetic.example.invalid/api/v1/system-one/planning?${query}`, { headers: auth ? { authorization: auth } : {} });
  return { api, request, calls: () => calls };
}
test("planning route gates environment, user token, config and duplicate parameters before reads", async () => {
  for (const [options, query, token, status] of [[{ enabled: false }, undefined, undefined, 404], [{}, undefined, "", 401],
    [{}, undefined, "Bearer bos_pat_test", 401], [{ configured: false }, undefined, undefined, 503],
    [{}, `id=${id(10)}&version=1&version=2`, undefined, 400]]) {
    const h = await routeHarness(options); assert.equal((await h.api.GET(h.request(query, token))).status, status); assert.equal(h.calls(), 0);
  }
});
test("route projects success, disables caching and redacts unexpected exceptions", async () => {
  const h = await routeHarness(); const response = await h.api.GET(h.request());
  assert.match(response.headers.get("cache-control"), /no-store/); assert.equal((await response.text()).includes("PRIVATE"), false);
  const bad = await routeHarness({ throws: true }); const failure = await bad.api.GET(bad.request());
  assert.equal(failure.status, 503); assert.equal((await failure.text()).includes("PRIVATE"), false);
});
