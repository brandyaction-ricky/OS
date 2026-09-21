import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";
import * as contentModule from "../lib/server/system-one-content-source.ts";
import * as documentModule from "../lib/server/system-one-document-source.ts";
const code = ts.transpileModule(await readFile(new URL("../lib/server/system-one-content-bundle.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const modules = { "node:crypto": { createHash }, zod: { z },
  "@/lib/server/system-one-content-source": contentModule, "@/lib/server/system-one-document-source": documentModule };
const compiled = { exports: {} };
runInNewContext(code, { module: compiled, exports: compiled.exports,
  require(name) { assert.ok(Object.hasOwn(modules, name)); return modules[name]; } });
const { loadSystemOneContentBundle: load, recheckSystemOneContentBundle: recheck } = compiled.exports;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const md5 = value => createHash("md5").update(value).digest("hex");
function harness() {
  const time = "2026-01-01T00:00:00.000Z";
  const row = n => ({ id: id(n), title: "Synthetic reference", content_md: "Synthetic", status: "canonical", owner_id: id(1),
    team: "", brand: null, folder: "Synthetic", current_version: 1, content_hash: md5("Synthetic"), updated_at: time });
  const state = { contentCalls: 0, documentCalls: 0, documentActor: id(1), onDocuments: () => {},
    topic: { id: id(10), record_type: "content_topic", title: "Synthetic topic", description: "Synthetic",
      status: "draft", stage: "", brand: "", team: "", owner_id: id(1), source_url: null, metadata: {}, version: 1, updated_at: time, archived_at: null },
    documents: [row(20), row(30)] };
  const input = { content: { kind: "content_topic", id: id(10), expectedVersion: 1 },
    registry: { kind: "knowledge_document", id: id(20), expectedVersion: 1 },
    criteria: [{ kind: "knowledge_document", id: id(30), expectedVersion: 1, requestedRole: "synthetic.planning", requestedSection: "Synthetic scope" }] };
  const deps = {
    content: { authenticate: async () => { state.contentCalls++; return {
      principal: { id: id(1), type: "user", active: true, mustChangePassword: false }, readHead: async () => state.topic }; } },
    documents: { authenticate: async () => { state.documentCalls++; return {
      principal: { id: state.documentActor, type: "user", role: "member", team: "", active: true, mustChangePassword: false },
      readHeads: async () => { state.onDocuments(); return state.documents; } }; } },
  };
  return { state, input, deps };
}
test("binds typed content, registry, requested references and contract without claiming policy qualification", async () => {
  const { state, input, deps } = harness(); const { status, snapshot } = await load(input, deps);
  assert.equal(status, "ready"); assert.equal(snapshot.content.kind, "content_topic");
  assert.equal(snapshot.registry.kind, "knowledge_document"); assert.equal(snapshot.criteria[0].requestedRole, "synthetic.planning");
  assert.equal(snapshot.policyStatus, "unverified"); assert.equal(snapshot.judgment, null); assert.equal(snapshot.executionAllowed, false);
  assert.equal(JSON.stringify(snapshot).includes("content_md"), false); assert.equal(state.contentCalls, 2);
  assert.ok(Object.isFrozen(snapshot.criteria[0]));
});
test("rejects missing criteria, duplicate roles, duplicate document IDs and unexpected fields before reads", async () => {
  for (const change of [i => { i.criteria = []; }, i => { i.criteria.push({ ...i.criteria[0], id: id(31) }); },
    i => { i.criteria[0].id = i.registry.id; }, i => { i.policyStatus = "qualified"; }]) {
    const { state, input, deps } = harness(); change(input);
    assert.equal((await load(input, deps)).code, "invalid_input"); assert.equal(state.contentCalls, 0);
  }
});
test("same UUID in different tables stays distinct", async () => {
  const { state, input, deps } = harness(); state.topic.id = input.registry.id; input.content.id = input.registry.id;
  assert.equal((await load(input, deps)).status, "ready");
});
for (const [name, change, code] of [
  ["content version", s => { s.topic.version++; }, "stale"],
  ["registry version", s => { s.documents[0].current_version++; }, "stale"],
  ["criterion version", s => { s.documents[1].current_version++; }, "stale"],
  ["same-version criterion body", s => { s.documents[1].content_md = "Changed"; s.documents[1].content_hash = md5("Changed"); }, "stale"],
  ["same-version source metadata", s => { s.topic.metadata.format = "board"; }, "stale"],
  ["criterion access removal", s => { s.documents[1].status = "draft"; s.documents[1].owner_id = id(2); }, "unavailable"],
  ["missing criterion", s => { s.documents.pop(); }, "unavailable"],
]) test(`recheck catches ${name}`, async () => {
  const { state, input, deps } = harness(); const { snapshot } = await load(input, deps);
  change(state); assert.equal((await recheck(snapshot, deps)).code, code);
});
test("different authenticated principals cannot contribute to one bundle", async () => {
  const { state, input, deps } = harness(); state.documentActor = id(2);
  assert.equal((await load(input, deps)).code, "unavailable");
});
test("catches topic changes during document read", async () => {
  const { state, input, deps } = harness(); state.onDocuments = () => { state.topic.metadata.change = true; };
  assert.equal((await load(input, deps)).code, "stale");
});
test("recheck rejects serialized handles and isolates original input mutations", async () => {
  const { input, deps } = harness(); const { snapshot } = await load(input, deps);
  assert.equal((await recheck({ ...snapshot }, deps)).code, "invalid_input");
  input.criteria[0].requestedSection = "Changed by caller";
  const second = await recheck(snapshot, deps);
  assert.equal(second.status, "ready"); assert.equal(second.snapshot.criteria[0].requestedSection, "Synthetic scope");
});
test("requested role and section affect fingerprint but do not become verified rules", async () => {
  const { input, deps } = harness(); const first = await load(input, deps);
  input.criteria[0].requestedSection = "Other synthetic scope";
  const second = await load(input, deps);
  assert.notEqual(first.snapshot.fingerprint, second.snapshot.fingerprint);
  assert.equal(second.snapshot.policyStatus, "unverified");
});
