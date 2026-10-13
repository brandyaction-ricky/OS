import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const turn = () => new Promise(resolve => setTimeout(resolve, 0));
function setup() {
  const hooks = [], effects = [], reads = [];
  let cursor = 0;
  const context = { loading: true, demo: false, token: "synthetic-token", actor: { ownerId: "synthetic-user" },
    loadDocument: id => new Promise(resolve => reads.push({ id, resolve })),
  };
  const react = {
    useState(initial) { const index = cursor++; if (!hooks[index]) hooks[index] = { value: initial }; return [hooks[index].value, next => { hooks[index].value = typeof next === "function" ? next(hooks[index].value) : next; }]; },
    useRef(value) { const index = cursor++; if (!hooks[index]) hooks[index] = { current: value }; return hooks[index]; },
    useEffect(fn, deps) { const index = cursor++, old = hooks[index]; if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) effects.push(() => { old?.cleanup?.(); hooks[index] = { deps, cleanup: fn() }; }); },
  };
  const modules = { react, "react/jsx-runtime": { jsx: (type, props) => ({ type, props }) }, "./provider": { useKnowledge: () => context }, "./ui": { Empty: "empty" } };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("../components/knowledge/editor.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(code, { exports, require: name => modules[name] ?? {} });
  return { context, reads, editor: exports.DocumentEditor,
    render(props) { cursor = 0; const result = exports.KnowledgeDocumentPage({ id: "synthetic-doc", ...props }); while (effects.length) effects.shift()(); return result; },
  };
}

test("read-only canonical body renders while supporting workspace is still loading", async () => {
  const app = setup(), props = { earlyCanonicalRead: true };
  app.render(props); assert.equal(app.reads.length, 1);
  app.reads[0].resolve({ id: "synthetic-doc", status: "canonical", content_md: "기준 본문" }); await turn();
  assert.equal(app.render(props).type, app.editor);
  app.context.loading = false; app.render(props);
  assert.equal(app.reads.length, 1, "supporting workspace completion must not re-fetch the body");
});

test("editable documents still wait for draft recovery before loading the editor", async () => {
  const app = setup();
  app.render(); assert.equal(app.reads.length, 0);
  app.context.loading = false; app.render(); assert.equal(app.reads.length, 1);
  app.reads[0].resolve({ id: "synthetic-doc", status: "draft" }); await turn();
  assert.equal(app.render().type, app.editor);
});

test("a noncanonical document on a canon URL cannot bypass draft readiness", async () => {
  const app = setup(), props = { earlyCanonicalRead: true };
  app.render(props); app.reads[0].resolve({ id: "synthetic-doc", status: "draft" }); await turn();
  assert.equal(app.render(props).type, "empty");
  app.context.loading = false;
  assert.equal(app.render(props).type, app.editor);
});
