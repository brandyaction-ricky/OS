import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as contract from "../lib/content-stage-reference.ts";
const id = "00000000-0000-4000-8000-000000000001";
const docId = "00000000-0000-4000-8000-000000000002";
const payload = () => ({ status: "ready", stage: "writing", source: { id, version: 1 }, registryVersion: 1,
  entryDocument: { role: "youtube.writing", id: docId, title: "Synthetic policy", version: 1 },
  dependenciesStatus: "unresolved", approvalStatus: "unverified", policyStatus: "unverified", judgment: null, executionAllowed: false });
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object" ? [value, ...nodes(value.props?.children)] : [];
async function compile(path, modules, globals = {}) {
  const code = ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const target = { exports: {} };
  runInNewContext(code, { module: target, exports: target.exports, URL, AbortController, ...globals,
    require(name) { assert.ok(Object.hasOwn(modules, name), name); return modules[name]; } });
  return target.exports;
}
async function ui() {
  const hooks = [], effects = [], calls = []; let cursor = 0;
  let props = { sourceId: id, sourceVersion: 1, token: "synthetic", disabled: false };
  let respond = async () => ({ ok: true, json: async () => payload() });
  const react = {
    useState(initial) { const i = cursor++; hooks[i] ??= { value: initial }; return [hooks[i].value, next => { hooks[i].value = typeof next === "function" ? next(hooks[i].value) : next; }]; },
    useRef(initial) { const i = cursor++; hooks[i] ??= { current: initial }; return hooks[i]; },
    useEffect(fn, deps) { const i = cursor++, old = hooks[i]; if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) effects.push(() => { old?.cleanup?.(); hooks[i] = { deps, cleanup: fn() }; }); },
  };
  const jsx = (type, props) => ({ type, props });
  const component = await compile("../components/content-stage-reference.tsx", { react, "react/jsx-runtime": { jsx, jsxs: jsx },
    "next/link": { default: "a" }, "@/lib/content-stage-reference": contract },
  { fetch: async (...args) => { calls.push(args); return respond(...args); } });
  const render = () => { cursor = 0; const tree = component.ContentStageReference(props); while (effects.length) effects.shift()(); return tree; };
  render();
  return { calls, render, text: () => JSON.stringify(render()), respond: fn => { respond = fn; },
    props(next) { props = { ...props, ...next }; render(); },
    click(index = 2) { nodes(render()).filter(n => n.type === "button")[index].props.onClick(); },
    unmount() { hooks.forEach(h => h.cleanup?.()); } };
}
test("stage schema rejects forged approval, role mismatch and extra fields", () => {
  assert.equal(contract.stageReferenceSchema.safeParse(payload()).success, true);
  for (const change of [b => b.executionAllowed = true, b => b.approvalStatus = "approved", b => b.entryDocument.role = "youtube.packaging", b => b.body = "PRIVATE"]) {
    const b = payload(); change(b); assert.equal(contract.stageReferenceSchema.safeParse(b).success, false);
  }
});
test("stage UI reads on explicit click only and states unresolved conditions", async () => {
  const app = await ui(); assert.equal(app.calls.length, 0); app.click(); app.click(); await settle();
  assert.equal(app.calls.length, 1); assert.match(app.calls[0][0], /stage=writing/);
  assert.equal(app.calls[0][1].cache, "no-store"); assert.equal(app.calls[0][1].method, undefined);
  assert.match(app.text(), /Synthetic policy/); assert.match(app.text(), /아직 대조하지 않았습니다/);
});
test("missing role clears old result and does not render raw errors", async () => {
  const app = await ui(); app.click(); await settle();
  app.respond(async () => ({ ok: false, json: async () => ({ code: "missing_role", message: "PRIVATE" }) }));
  app.click(); await settle(); assert.doesNotMatch(app.text(), /Synthetic policy|PRIVATE/); assert.match(app.text(), /등록부에 연결되지/);
});
test("stage switch discards prior result and ignores late response", async () => {
  const app = await ui(); let finish;
  app.respond(() => new Promise(resolve => { finish = resolve; })); app.click(); app.click(0); app.render();
  finish({ ok: true, json: async () => payload() }); await settle();
  assert.equal(app.calls[0][1].signal.aborted, true); assert.doesNotMatch(app.text(), /Synthetic policy/);
  const b = payload(); b.stage = "packaging"; b.entryDocument.role = "youtube.packaging";
  app.respond(async () => ({ ok: true, json: async () => b })); app.click(); await settle();
  assert.match(app.text(), /Synthetic policy/); assert.match(app.calls[1][0], /stage=packaging/);
});
for (const prop of [{ token: "other" }, { sourceVersion: 2 }, { sourceId: docId }, { disabled: true }]) test(`stage result invalidates for ${Object.keys(prop)[0]}`, async () => {
  const app = await ui(); app.click(); await settle(); app.props(prop); assert.doesNotMatch(app.text(), /Synthetic policy/);
  if (prop.disabled) { app.click(); assert.equal(app.calls.length, 1); }
});
test("wrong source version or stage responses never display the document", async () => {
  for (const change of [b => b.source.version = 2, b => b.source.id = docId, b => { b.stage = "packaging"; b.entryDocument.role = "youtube.packaging"; }]) {
    const app = await ui(), b = payload(); change(b); app.respond(async () => ({ ok: true, json: async () => b })); app.click(); await settle();
    assert.doesNotMatch(app.text(), /Synthetic policy/);
  }
});
async function route({ enabled = true, configured = true, throws = false, code } = {}) {
  let calls = 0;
  const api = await compile("../app/api/v1/system-one/stage-reference/route.ts", {
    "next/server": { NextResponse: Response }, "@/lib/system-one-preflight-gate": { canUseSystemOnePreflight: () => enabled },
    "@/lib/server/system-one-planning": { planningRegistryConfig: () => configured ? { id: docId, expectedVersion: 1 } : null },
    "@/lib/server/system-one-stage-references": { readStageReferences: async () => { calls++; if (throws) throw new Error("PRIVATE"); return code ? { status: "stopped", code } : { ...payload(), privateBody: "PRIVATE" }; } },
    "@/lib/server/system-one-user-content-source": { createSystemOneUserContentSource: () => ({}) },
    "@/lib/server/system-one-user-source": { createSystemOneUserDocumentSource: () => ({}) },
  }, { process: { env: {} } });
  return { calls: () => calls, get: (query = `id=${id}&version=1&stage=writing`, token = "Bearer synthetic") => api.GET(new Request(`https://example.test/api?${query}`, { headers: { authorization: token } })) };
}
test("stage route preserves DEV, human auth, configuration and strict query gates", async () => {
  for (const [options, query, token, expected] of [[{ enabled: false }, undefined, undefined, 404], [{}, undefined, "", 401],
    [{}, undefined, "Bearer bos_pat_test", 401], [{ configured: false }, undefined, undefined, 503],
    [{}, `id=${id}&version=1&stage=writing&stage=packaging`, undefined, 400], [{}, `id=${id}&version=1&stage=publish`, undefined, 400]]) {
    const h = await route(options); assert.equal((await h.get(query, token)).status, expected); assert.equal(h.calls(), 0);
  }
});
test("stage route is no-store and redacts unexpected server fields and exceptions", async () => {
  const h = await route(); const response = await h.get(); assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/); assert.equal(response.headers.get("vary"), "Authorization");
  assert.equal((await response.text()).includes("PRIVATE"), false);
  const fail = await route({ throws: true }); const bad = await fail.get(); assert.equal(bad.status, 503); assert.equal((await bad.text()).includes("PRIVATE"), false);
  const missing = await route({ code: "missing_role" }); assert.equal((await missing.get()).status, 409);
});
