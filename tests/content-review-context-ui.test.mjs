import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as review from "../lib/content-review-context.ts";
import * as production from "../lib/content-production-links.ts";
const code = ts.transpileModule(await readFile(new URL("../components/content-review-context.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const id = "00000000-0000-4000-8000-000000000001";
const body = () => ({ status: "ready", policyStatus: "unverified", judgment: null, executionAllowed: false,
  source: { id, version: 1 }, registryVersion: 1, referenceCount: 2, packageCount: 0, linkedDocuments: [],
  markers: { source: "a".repeat(64), criteria: "b".repeat(64), bundle: "c".repeat(64) } });
const settle = async () => { for (let n = 0; n < 10; n++) await Promise.resolve(); };
const children = node => Array.isArray(node) ? node.flatMap(children) : node && typeof node === "object" ? [node, ...children(node.props?.children)] : [];
function setup() {
  const hooks = [], effects = [], calls = [];
  let cursor = 0, props = { sourceId: id, sourceVersion: 1, token: "synthetic", disabled: false };
  let response = async () => ({ ok: true, json: async () => body() });
  const react = {
    useState(initial) { const i = cursor++; hooks[i] ??= { value: initial }; return [hooks[i].value, next => { hooks[i].value = typeof next === "function" ? next(hooks[i].value) : next; }]; },
    useRef(initial) { const i = cursor++; hooks[i] ??= { current: initial }; return hooks[i]; },
    useEffect(fn, deps) { const i = cursor++, old = hooks[i]; if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) {
      effects.push(() => { old?.cleanup?.(); hooks[i] = { deps, cleanup: fn() }; });
    } },
  };
  const jsx = (type, props) => ({ type, props });
  const modules = { react, "react/jsx-runtime": { jsx, jsxs: jsx }, "next/link": { default: "a" }, "@/lib/content-production-links": production, "@/lib/content-review-context": review };
  const compiled = { exports: {} };
  runInNewContext(code, { module: compiled, exports: compiled.exports, AbortController,
    fetch: async (...args) => { calls.push(args); return response(...args); },
    require(name) { assert.ok(Object.hasOwn(modules, name), name); return modules[name]; } });
  const render = () => { cursor = 0; const tree = compiled.exports.ContentReviewContext(props); while (effects.length) effects.shift()(); return tree; };
  render();
  return { calls, render, text: () => JSON.stringify(render()),
    setProps(next) { props = { ...props, ...next }; render(); },
    respond(fn) { response = fn; },
    click() { children(render()).find(n => n.type === "button").props.onClick(); },
    unmount() { hooks.forEach(h => h.cleanup?.()); },
  };
}
test("review UI is user-triggered read-only and preserves first comparison baseline", async () => {
  const app = setup(); assert.equal(app.calls.length, 0); app.click(); await settle();
  assert.match(app.text(), /감지된 변경이 없습니다/);
  assert.equal(app.calls[0][1].cache, "no-store"); assert.equal(app.calls[0][1].method, undefined);
  const changed = body(); changed.markers.bundle = "d".repeat(64);
  app.respond(async () => ({ ok: true, json: async () => changed })); app.click(); await settle();
  assert.match(app.text(), /처음 확인한 때와 다릅니다/); app.click(); await settle();
  assert.match(app.text(), /처음 확인한 때와 다릅니다/);
});
test("failed recheck hides previous success and does not echo server messages", async () => {
  const app = setup(); app.click(); await settle();
  app.respond(async () => ({ ok: false, json: async () => ({ code: "unavailable", message: "PRIVATE" }) }));
  app.click(); await settle(); assert.match(app.text(), /접근 권한/);
  assert.doesNotMatch(app.text(), /조회 시점/); assert.doesNotMatch(app.text(), /PRIVATE/);
});
test("source updates require a new check and editing disables reads", async () => {
  const app = setup(); app.click(); await settle(); app.setProps({ sourceVersion: 2 });
  assert.doesNotMatch(app.text(), /조회 시점/);
  const changed = body(); changed.source.version = 2; changed.markers.source = "d".repeat(64); changed.markers.bundle = "e".repeat(64);
  app.respond(async () => ({ ok: true, json: async () => changed })); app.click(); await settle();
  assert.match(app.text(), /기획 자료가 바뀌었습니다/);
  const count = app.calls.length; app.setProps({ disabled: true }); app.click(); await settle(); assert.equal(app.calls.length, count);
});
test("session changes discard baseline and late responses cannot revive it", async () => {
  const app = setup(); let finish;
  app.respond(() => new Promise(resolve => { finish = resolve; })); app.click();
  app.setProps({ token: "other-session" });
  finish({ ok: true, json: async () => body() }); await settle(); assert.doesNotMatch(app.text(), /조회 시점/);
  assert.equal(app.calls[0][1].signal.aborted, true);
  app.respond(async () => ({ ok: true, json: async () => body() })); app.click(); await settle();
  assert.match(app.text(), /감지된 변경이 없습니다/);
  app.setProps({ token: "synthetic" }); assert.doesNotMatch(app.text(), /조회 시점/);
});
test("wrong source/version and forged completion responses never render success", async () => {
  for (const change of [b => { b.source.version = 2; }, b => { b.source.id = "00000000-0000-4000-8000-000000000002"; }, b => { b.executionAllowed = true; }]) {
    const app = setup(), bad = body(); change(bad); app.respond(async () => ({ ok: true, json: async () => bad }));
    app.click(); await settle(); assert.doesNotMatch(app.text(), /조회 시점/); assert.match(app.text(), /자료를 확인하지 못했습니다/);
  }
});
test("linked documents show connection/current versions; a failed recheck hides titles", async () => {
  const app = setup(), linked = body(); linked.linkedDocuments = [{ id: "00000000-0000-4000-8000-000000000003", title: "Synthetic manuscript", role: "manuscript", version: 2, linkedVersion: 1, linkedSourceVersion: 1, marker: "d".repeat(64) }];
  app.respond(async () => ({ ok: true, json: async () => linked })); app.click(); await settle();
  assert.match(app.text(), /Synthetic manuscript/); assert.match(app.text(), /연결 이후 문서 버전 변경/);
  app.respond(async () => ({ ok: false, json: async () => ({ code: "linked_documents_unavailable" }) })); app.click(); await settle();
  assert.doesNotMatch(app.text(), /Synthetic manuscript/); assert.match(app.text(), /전체 확인 결과는 보류/);
});
