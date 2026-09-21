import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";
import * as documents from "../lib/server/system-one-document-source.ts";
import * as content from "../lib/server/system-one-content-source.ts";
import * as packaging from "../lib/server/system-one-packaging-source.ts";
import * as productionLinks from "../lib/content-production-links.ts";
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
const bundle = await compile("../lib/server/system-one-content-bundle.ts", { zod: { z }, "node:crypto": { createHash },
  "@/lib/server/system-one-content-source": content, "@/lib/server/system-one-document-source": documents,
  "@/lib/server/system-one-packaging-source": packaging });
const review = await compile("../lib/server/system-one-review-context.ts", { "node:crypto": { createHmac },
  "@/lib/content-production-links": productionLinks,
  "@/lib/server/system-one-content-source": content, "@/lib/server/system-one-document-source": documents,
  "@/lib/server/system-one-content-bundle": bundle, "@/lib/server/system-one-planning": planning });
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
    packaging: { authenticate: async () => ({ principal, readPackages: async () => [] }) },
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
async function routeHarness({ enabled = true, configured = true, result, throws = false, reviewRoute = false } = {}) {
  let calls = 0;
  const api = await compile(`../app/api/v1/system-one/${reviewRoute ? "review-context" : "planning"}/route.ts`, {
    "@/lib/server/system-one-review-context": { readReviewContext: async () => { calls++; if (throws) throw new Error("PRIVATE"); return result ?? {
      status: "ready", source: { id: id(10), version: 1 }, registryVersion: 1, referenceCount: 2, packageCount: 0, linkedDocuments: [],
      markers: { source: "a".repeat(64), criteria: "b".repeat(64), bundle: "c".repeat(64) }, privateBody: "PRIVATE" }; } },
    "next/server": { NextResponse: Response }, "@/lib/system-one-preflight-gate": { canUseSystemOnePreflight: () => enabled },
    "@/lib/server/system-one-planning": { planningRegistryConfig: () => configured ? { id: id(2), expectedVersion: 1 } : null,
      checkPlanningReferences: async () => { calls++; if (throws) throw new Error("PRIVATE"); return result ?? {
        status: "ready", source: { id: id(10), version: 1 }, registryVersion: 1, referenceCount: 2, privateBody: "PRIVATE" }; } },
    "@/lib/server/system-one-user-content-source": { createSystemOneUserContentSource: () => ({}), createSystemOneUserPackagingSource: () => ({}) },
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

test("review context resolves configured planning roles and binds packages without emitting private bodies", async () => {
  const h = harness(); const first = await review.readReviewContext(h.input, h.registry, h.deps, "synthetic-session");
  assert.equal(first.status, "ready"); assert.equal(first.referenceCount, 2); assert.equal(first.packageCount, 0);
  assert.equal(first.executionAllowed, false); assert.equal(first.policyStatus, "unverified");
  assert.equal(JSON.stringify(first).includes("Synthetic"), false); assert.equal(JSON.stringify(first).includes("synthetic-session"), false);
  const second = await review.readReviewContext(h.input, h.registry, h.deps, "synthetic-session");
  assert.deepEqual(first.markers, second.markers);
  const other = await review.readReviewContext(h.input, h.registry, h.deps, "other-session");
  assert.notEqual(first.markers.bundle, other.markers.bundle);
});
test("review detects same-version source and criteria changes through independent markers", async () => {
  const h = harness(); const first = await review.readReviewContext(h.input, h.registry, h.deps, "session");
  h.state.topic.metadata.planningHandoff = { productionFormat: "board" };
  const second = await review.readReviewContext(h.input, h.registry, h.deps, "session");
  assert.notEqual(first.markers.source, second.markers.source); assert.equal(first.markers.criteria, second.markers.criteria);
  h.state.rows[2].content_md = "Changed"; h.state.rows[2].content_hash = md5("Changed");
  const third = await review.readReviewContext(h.input, h.registry, h.deps, "session");
  assert.notEqual(second.markers.criteria, third.markers.criteria); assert.notEqual(second.markers.bundle, third.markers.bundle);
});
test("review binds newly visible packages and rejects missing package dependencies", async () => {
  const h = harness(); const first = await review.readReviewContext(h.input, h.registry, h.deps, "session");
  h.deps.packaging.authenticate = async () => ({ principal: { id: id(1), type: "user", active: true, mustChangePassword: false },
    readPackages: async () => [{ id: id(90), record_type: "content_package", parent_id: id(10), owner_id: id(1), metadata: {},
      version: 1, created_at: h.state.topic.updated_at, updated_at: h.state.topic.updated_at, archived_at: null }] });
  const second = await review.readReviewContext(h.input, h.registry, h.deps, "session");
  assert.equal(second.packageCount, 1); assert.notEqual(first.markers.bundle, second.markers.bundle);
  assert.equal(first.markers.source, second.markers.source); delete h.deps.packaging;
  assert.equal((await review.readReviewContext(h.input, h.registry, h.deps, "session")).code, "invalid_input");
});
test("review endpoint preserves DEV/auth/config gates and redacts errors", async () => {
  for (const [options, query, token, status] of [[{ enabled: false }, undefined, undefined, 404], [{}, undefined, "", 401],
    [{}, undefined, "Bearer bos_pat_test", 401], [{ configured: false }, undefined, undefined, 503],
    [{}, `id=${id(10)}&version=1&version=2`, undefined, 400]]) {
    const h = await routeHarness({ ...options, reviewRoute: true });
    assert.equal((await h.api.GET(h.request(query, token))).status, status); assert.equal(h.calls(), 0);
  }
  const h = await routeHarness({ reviewRoute: true }); const response = await h.api.GET(h.request());
  assert.match(response.headers.get("cache-control"), /no-store/); assert.equal((await response.text()).includes("PRIVATE"), false);
  const bad = await routeHarness({ reviewRoute: true, throws: true });
  const failed = await bad.api.GET(bad.request()); assert.equal(failed.status, 503); assert.equal((await failed.text()).includes("PRIVATE"), false);
});
function linkedHarness(count = 1) {
  const h = harness(); h.state.topic.metadata.productionDocumentLinks = [];
  for (let n = 0; n < count; n++) {
    h.state.rows.push({ ...h.state.rows[2], id: id(100 + n), status: "draft", title: `Synthetic linked ${n}`, content_md: "Linked body", content_hash: md5("Linked body") });
    h.state.topic.metadata.productionDocumentLinks.push({ documentId: id(100 + n), role: "design", documentVersion: 1, sourceVersion: 1 });
  }
  return h;
}
test("explicit linked drafts join the review bundle without becoming canonical policies", async () => {
  const h = linkedHarness(); const result = await review.readReviewContext(h.input, h.registry, h.deps, "session");
  assert.equal(result.status, "ready"); assert.equal(result.linkedDocuments[0].title, "Synthetic linked 0");
  assert.equal(result.linkedDocuments[0].linkedVersion, 1); assert.equal(result.policyStatus, "unverified");
  assert.equal(JSON.stringify(result).includes("Linked body"), false); assert.equal(JSON.stringify(result).includes("owner_id"), false);
});
test("same-version linked body changes alter document and aggregate markers, not planning criteria", async () => {
  const h = linkedHarness(); const first = await review.readReviewContext(h.input, h.registry, h.deps, "session");
  h.state.rows.at(-1).content_md = "Changed body"; h.state.rows.at(-1).content_hash = md5("Changed body");
  const next = await review.readReviewContext(h.input, h.registry, h.deps, "session");
  assert.notEqual(first.linkedDocuments[0].marker, next.linkedDocuments[0].marker); assert.notEqual(first.markers.bundle, next.markers.bundle);
  assert.equal(first.markers.criteria, next.markers.criteria); assert.equal(first.markers.source, next.markers.source);
});
test("current document version can differ from the recorded connection version", async () => {
  const h = linkedHarness(); h.state.rows.at(-1).current_version = 2;
  const result = await review.readReviewContext(h.input, h.registry, h.deps, "session");
  assert.equal(result.status, "ready"); assert.equal(result.linkedDocuments[0].version, 2); assert.equal(result.linkedDocuments[0].linkedVersion, 1);
});
for (const [name, change] of [
  ["missing", s => { s.rows.pop(); }], ["private", s => { s.rows.at(-1).owner_id = id(99); }],
  ["archived", s => { s.rows.at(-1).status = "archived"; }], ["bad hash", s => { s.rows.at(-1).content_hash = "a".repeat(32); }],
]) test(`one ${name} linked document blocks the whole response without partial titles`, async () => {
  const h = linkedHarness(2); change(h.state); const result = await review.readReviewContext(h.input, h.registry, h.deps, "session");
  assert.equal(result.code, "linked_documents_unavailable"); assert.equal(JSON.stringify(result).includes("Synthetic linked"), false);
});
test("malformed or future-version links fail instead of silently dropping documents", async () => {
  for (const value of [null, {}, [{ documentId: id(100), role: "design", documentVersion: 1, sourceVersion: 2 }]]) {
    const h = linkedHarness(); h.state.topic.metadata.productionDocumentLinks = value;
    assert.equal((await review.readReviewContext(h.input, h.registry, h.deps, "session")).code, "invalid_linked_documents");
  }
});
test("bounded batch supports twelve links and applies aggregate body limit", async () => {
  const h = linkedHarness(12); assert.equal((await review.readReviewContext(h.input, h.registry, h.deps, "session")).linkedDocuments.length, 12);
  for (const row of h.state.rows.slice(3)) { row.content_md = "x".repeat(50000); row.content_hash = md5(row.content_md); }
  assert.equal((await review.readReviewContext(h.input, h.registry, h.deps, "session")).code, "linked_documents_unavailable");
});
