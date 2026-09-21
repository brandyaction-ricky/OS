import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as links from "../lib/content-production-links.ts";
const code = ts.transpileModule(await readFile(new URL("../components/content-production-documents.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const children = n => Array.isArray(n) ? n.flatMap(children) : n && typeof n === "object" ? [n, ...children(n.props?.children)] : [];
function setup({ denied = false, conflict = false, linked = false } = {}) {
  const hooks = [], effects = [], reads = [], writes = [], saved = []; let cursor = 0;
  const source = { id: id(1), version: 4, metadata: linked ? { productionDocumentLinks: [{ documentId: id(2), role: "design", documentVersion: 1, sourceVersion: 3 }] } : {} };
  const react = {
    useState(initial) { const i = cursor++; hooks[i] ??= { value: initial }; return [hooks[i].value, next => { hooks[i].value = typeof next === "function" ? next(hooks[i].value) : next; }]; },
    useRef(initial) { const i = cursor++; hooks[i] ??= { current: initial }; return hooks[i]; },
    useEffect(fn, deps) { const i = cursor++, old = hooks[i]; if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) effects.push(() => { old?.cleanup?.(); hooks[i] = { deps, cleanup: fn() }; }); },
  };
  const jsx = (type, props) => ({ type, props });
  const modules = { react, "react/jsx-runtime": { jsx, jsxs: jsx }, "next/link": { default: "a" },
    "@/lib/content-production-links": links, "@/lib/api-client": { updateRecord: async (_token, input) => {
      writes.push(input); if (conflict) throw new Error("Synthetic version conflict"); return { record: { ...source, version: 5, metadata: input.metadata } };
    } } };
  const compiled = { exports: {} };
  runInNewContext(code, { module: compiled, exports: compiled.exports, Error,
    FormData: class { constructor(form) { this.fields = form; } get(key) { return this.fields[key]; } },
    fetch: async (url, options) => { reads.push({ url, options }); return { ok: !denied, json: async () => ({ status: denied ? "stopped" : "ready",
      document: { id: id(2), title: "Synthetic document", version: 2, status: "draft" }, executionAllowed: false, judgment: null, policyStatus: "unverified" }) }; },
    require(name) { assert.ok(Object.hasOwn(modules, name), name); return modules[name]; } });
  let disabled = false;
  const render = () => { cursor = 0; const tree = compiled.exports.ContentProductionDocuments({ source, token: "synthetic", disabled, onSaved: record => saved.push(record) }); while (effects.length) effects.shift()(); return tree; };
  render();
  return { reads, writes, saved, source, render,
    submit: () => children(render()).find(n => n.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: { document: id(2), role: "design" } }),
    disable: () => { disabled = true; render(); }, text: () => JSON.stringify(render()),
  };
}
test("document link UI reads first, then writes only a version-checked reference", async () => {
  const app = setup(); await app.submit(); assert.equal(app.reads.length, 1); assert.equal(app.writes.length, 1); assert.equal(app.saved.length, 1);
  assert.equal(app.writes[0].expectedVersion, 4); assert.equal(app.writes[0].metadata.productionDocumentLinks[0].documentVersion, 2);
  assert.equal(JSON.stringify(app.writes).includes("Synthetic document"), false); assert.equal(app.reads[0].options.cache, "no-store");
});
test("read denial prevents writes; version conflict never reports a saved link", async () => {
  const denied = setup({ denied: true }); await denied.submit(); assert.equal(denied.writes.length, 0); assert.equal(denied.saved.length, 0);
  assert.match(denied.text(), /접근 권한/);
  const conflict = setup({ conflict: true }); await conflict.submit(); assert.equal(conflict.saved.length, 0); assert.match(conflict.text(), /version conflict/);
});
test("duplicate submissions and editing cannot create multiple references", async () => {
  const app = setup(); await Promise.all([app.submit(), app.submit()]); assert.equal(app.writes.length, 1);
  const disabled = setup(); disabled.disable(); await disabled.submit(); assert.equal(disabled.reads.length, 0);
});
test("linked document reread displays version change without writes", async () => {
  const app = setup({ linked: true }); children(app.render()).find(n => n.type === "button" && n.props.children === "현재 문서 확인").props.onClick();
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(app.writes.length, 0); assert.match(app.text(), /문서 버전이 바뀌었습니다/); assert.match(app.text(), /주제 버전이 바뀌었습니다/);
});
