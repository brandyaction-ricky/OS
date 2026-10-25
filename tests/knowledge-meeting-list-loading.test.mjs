import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as model from "../lib/knowledge/model.ts";

const turn = () => new Promise(resolve => setTimeout(resolve, 0));
const snapshot = id => ({ meetings: [{ id, title: id, status: "planned", starts_at: null, updated_at: "2026-10-12T00:00:00Z", attendees: [], visibility: "team" }], people: [] });
const descendants = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(descendants) : [node, ...descendants(node.props?.children)];
const links = node => descendants(node).filter(item => item.type === "a").map(item => item.props.href);
const statuses = node => descendants(node).filter(item => item.props?.role === "status");
const alerts = node => descendants(node).filter(item => item.props?.role === "alert");

function setup() {
  const hooks = [], effects = [], requests = [], listeners = new Map();
  let cursor = 0, token = "account-one", demo = false;
  const react = {
    useState(initial) { const index = cursor++; if (!hooks[index]) hooks[index] = { value: typeof initial === "function" ? initial() : initial }; return [hooks[index].value, next => { hooks[index].value = typeof next === "function" ? next(hooks[index].value) : next; }]; },
    useRef(initial) { const index = cursor++; if (!hooks[index]) hooks[index] = { current: initial }; return hooks[index]; },
    useEffect(fn, deps) { const index = cursor++, old = hooks[index]; if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) effects.push(() => { old?.cleanup?.(); hooks[index] = { deps, cleanup: fn() }; }); },
  };
  const jsx = (type, props) => ({ type, props });
  const modules = {
    react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" }, "next/link": { default: "a" },
    "next/navigation": { useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace() {} }) },
    "./provider": { useKnowledge: () => ({ state: model.emptyKnowledgeState(), token, demo }) },
    "./ui": { Header: "header", Card: "card", Empty: "empty", Modal: "modal", NewDocumentButton: "new-document" },
    "./meeting-capture": {}, "@/components/knowledge-workspace": {}, "@/components/knowledge-rich-editor": {},
    "@/lib/knowledge/model": model, "@/lib/knowledge/meetings": {}, "@/lib/meeting-markdown": {},
    "@/lib/api-client": { apiRequest: (path, options) => new Promise((resolve, reject) => requests.push({ path, options, resolve, reject })) },
  };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("../components/knowledge/meetings.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(code, { exports, require: name => { assert.ok(name in modules, name); return modules[name]; }, AbortController, URLSearchParams,
    window: { addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) },
  });
  const flush = () => { while (effects.length) effects.shift()(); };
  return {
    requests, flush,
    render({ flushEffects = true } = {}) { cursor = 0; const result = exports.KnowledgeMeetings(); if (flushEffects) flush(); return result; },
    token(value) { token = value; }, demo(value) { demo = value; },
    focus: () => listeners.get("focus")?.(),
  };
}

test("meeting list loads its summary only and revalidates on focus", async () => {
  const app = setup();
  assert.equal(statuses(app.render()).length, 1);
  assert.deepEqual(app.requests.map(request => request.path), ["/api/v1/knowledge/meetings"]);
  app.requests[0].resolve(snapshot("first")); await turn();
  assert.deepEqual(links(app.render()), ["/knowledge/meetings/first"]);
  app.focus(); app.render();
  assert.equal(app.requests.length, 2);
  app.requests[1].resolve(snapshot("updated")); await turn();
  const view = app.render();
  assert.deepEqual(links(view), ["/knowledge/meetings/updated"]);
  assert.equal(statuses(view).length, 0);
});

test("account changes hide previous rows before effects and ignore stale responses", async () => {
  const app = setup(); app.render(); app.requests[0].resolve(snapshot("previous")); await turn(); app.render();
  app.focus(); app.render();
  const oldRefresh = app.requests[1];
  app.token("account-two");
  const beforeEffects = app.render({ flushEffects: false });
  assert.deepEqual(links(beforeEffects), []);
  assert.equal(statuses(beforeEffects).length, 1);
  app.flush();
  assert.equal(oldRefresh.options.signal.aborted, true);
  oldRefresh.resolve(snapshot("stale")); await turn();
  assert.deepEqual(links(app.render()), []);
  app.requests[2].resolve(snapshot("current")); await turn();
  assert.deepEqual(links(app.render()), ["/knowledge/meetings/current"]);
  app.token(null);
  assert.deepEqual(links(app.render()), [], "sign-out also removes the current account's rows immediately");
});

test("failed revalidation removes old rows and explicit retry recovers", async () => {
  const app = setup(); app.render(); app.requests[0].resolve(snapshot("obsolete")); await turn(); app.render();
  app.focus(); app.render(); app.requests[1].reject(new Error("읽기 권한을 확인해 주세요.")); await turn();
  const view = app.render();
  assert.deepEqual(links(view), []);
  assert.equal(statuses(view).length, 0);
  const error = alerts(view)[0]; assert.ok(error);
  descendants(error).find(item => item.type === "button").props.onClick(); app.render();
  app.requests[2].resolve(snapshot("allowed")); await turn();
  assert.deepEqual(links(app.render()), ["/knowledge/meetings/allowed"]);
  assert.equal(alerts(app.render()).length, 0);
});
