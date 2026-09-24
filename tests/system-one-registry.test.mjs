import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";
import * as source from "../lib/server/system-one-document-source.ts";
const code = ts.transpileModule(await readFile(new URL("../lib/server/system-one-registry.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const modules = { zod: { z }, "@/lib/server/system-one-document-source": source };
const compiled = { exports: {} };
runInNewContext(code, { module: compiled, exports: compiled.exports, Buffer,
  require(name) { assert.ok(Object.hasOwn(modules, name)); return modules[name]; } });
const { parseSystemOneRegistry: parse, resolveSystemOneRegistryRoles: resolve } = compiled.exports;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const heading = "### 9-2. 역할 → 원문 등록부";
const header = "| 역할키 | 대상 doc_id | 담당 범위 | 검색 별칭·옛 이름 |";
const entry = (role = "synthetic.planning", target = id(3)) => `| \`${role}\` | \`${target}\` | Synthetic scope | Old title |`;
const markdown = rows => `${heading}\n\n${header}\n|---|---|---|---|\n${rows ?? entry()}\n\n### 9-3. History\n${entry("synthetic.old", id(4))}`;
const md5 = value => createHash("md5").update(value).digest("hex");
function harness() {
  const row = (n, text) => ({ id: id(n), title: "Synthetic", content_md: text, status: "canonical", owner_id: id(1),
    team: "", brand: null, folder: "Synthetic", current_version: 1, content_hash: md5(text), updated_at: "2026-01-01T00:00:00.000Z" });
  const state = { calls: 0, actor: id(1), onRead: () => {}, rows: [row(2, markdown()), row(3, "Synthetic criterion")] };
  const deps = { authenticate: async () => ({
    principal: { id: state.actor, type: "user", role: "member", team: "", active: true, mustChangePassword: false },
    readHeads: async ids => { state.calls++; state.onRead(ids); return state.rows.filter(row => ids.includes(row.id)); },
  }) };
  return { state, deps, registry: { id: id(2), expectedVersion: 1 } };
}
test("parses only the current registry and ignores history and fenced examples", () => {
  const rows = parse("```md\n" + markdown(entry("synthetic.fake")) + "\n```\n" + markdown());
  assert.equal(rows.length, 1); assert.equal(rows[0].role, "synthetic.planning"); assert.ok(Object.isFrozen(rows[0]));
  assert.equal(parse("```\n" + markdown() + "\n```"), null);
});
test("rejects malformed, ambiguous and interrupted tables instead of searching prose", () => {
  for (const text of [markdown(entry() + "\n" + entry()), markdown(entry("bad")), markdown(entry("synthetic.planning", "not-uuid")),
    markdown().replace(header, "| Other | Table |"), markdown(entry() + "\n\n" + entry("synthetic.extra")),
    markdown() + "\n" + markdown(), markdown().replace("|---|---|---|---|", "invalid"), "x".repeat(120001)]) {
    assert.equal(parse(text), null);
  }
});
test("registry-resolved IDs retain actual versions and scope but do not grant business approval", async () => {
  const { state, deps, registry } = harness(); const result = await resolve(registry, ["synthetic.planning"], deps);
  assert.equal(result.status, "resolved"); assert.equal(result.references[0].id, id(3));
  assert.equal(result.references[0].version, 1); assert.equal(result.references[0].scope, "Synthetic scope");
  assert.equal(result.mappingStatus, "registry_verified"); assert.equal(result.policyStatus, "unverified");
  assert.equal(result.executionAllowed, false); assert.equal(state.calls, 3);
});
test("missing and duplicate requested roles fail without fallback", async () => {
  const { deps, registry } = harness();
  assert.equal((await resolve(registry, ["synthetic.old"], deps)).code, "missing_role");
  assert.equal((await resolve(registry, ["synthetic.planning", "synthetic.planning"], deps)).code, "invalid_input");
});
for (const [name, mutate, expected] of [
  ["draft registry", s => { s.rows[0].status = "draft"; }, "approval_required"],
  ["draft criterion", s => { s.rows[1].status = "draft"; }, "approval_required"],
  ["unreadable criterion", s => { s.rows[1].owner_id = id(9); s.rows[1].status = "draft"; }, "unavailable"],
  ["missing criterion", s => { s.rows.pop(); }, "unavailable"],
  ["bad registry body hash", s => { s.rows[0].content_md += " changed"; }, "invalid_metadata"],
]) test(`fails closed: ${name}`, async () => { const { state, deps, registry } = harness(); mutate(state);
  assert.equal((await resolve(registry, ["synthetic.planning"], deps)).code, expected); });
test("detects same-version registry changes during target discovery", async () => {
  const { state, deps, registry } = harness();
  state.onRead = () => { if (state.calls === 2) {
    state.rows[0].content_md = markdown(entry("synthetic.planning", id(4))); state.rows[0].content_hash = md5(state.rows[0].content_md);
  } };
  assert.equal((await resolve(registry, ["synthetic.planning"], deps)).code, "stale");
});
test("detects target version change after discovery", async () => {
  const { state, deps, registry } = harness();
  state.onRead = () => { if (state.calls === 3) state.rows[1].current_version = 2; };
  assert.equal((await resolve(registry, ["synthetic.planning"], deps)).code, "stale");
});
test("does not collapse two roles into a duplicate document or self-reference", async () => {
  const { state, deps, registry } = harness();
  for (const text of [markdown(entry() + "\n" + entry("synthetic.second")), markdown(entry("synthetic.planning", id(2)))]) {
    state.rows[0].content_md = text; state.rows[0].content_hash = md5(text);
    const roles = text.includes("synthetic.second") ? ["synthetic.planning", "synthetic.second"] : ["synthetic.planning"];
    assert.equal((await resolve(registry, roles, deps)).code, "ambiguous_mapping");
  }
});
test("does not change the existing public preflight minimum criteria requirement", async () => {
  const { deps, registry } = harness();
  assert.equal((await source.loadSystemOneDocumentBundle({ source: registry, criteria: [] }, deps)).code, "invalid_input");
  assert.equal((await source.loadSystemOneRegistryHead(registry, deps)).status, "ready");
});
