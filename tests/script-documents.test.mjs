import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as scripts from "../lib/script-documents.ts";

test("new scripts use the existing document API with a bounded video folder and default outline", () => {
  const input = scripts.buildScriptDocumentInput({ title: " 첫 원고 ", folderName: " 새 영상 ", content: "" });
  assert.equal(input.title, "첫 원고");
  assert.equal(input.folder, `${scripts.SCRIPT_DOCUMENT_ROOT}/새 영상`);
  assert.match(input.content, /^# 첫 원고\n/);
  assert.match(input.content, /## 도입/);
  assert.equal(input.source, "wiki");
  assert.equal("owner_id" in input, false);
  assert.equal("status" in input, false);
  assert.equal("current_version" in input, false);
  assert.equal(scripts.buildScriptDocumentInput({ title: "a".repeat(200), folderName: "b".repeat(scripts.SCRIPT_FOLDER_NAME_LIMIT), content: "본문" }).folder.length, 160);
  for (const folderName of ["", "..", "../다른 폴더", "다른/폴더", "다른\\폴더", "다른\n폴더", "a".repeat(scripts.SCRIPT_FOLDER_NAME_LIMIT + 1)]) {
    assert.throws(() => scripts.buildScriptDocumentInput({ title: "원고", folderName, content: "본문" }));
  }
  assert.throws(() => scripts.buildScriptDocumentInput({ title: "a".repeat(201), folderName: "영상", content: "본문" }));
});

const source = await readFile(new URL("../components/content-pipeline-workspaces.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const settle = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
const documentRow = (id, fields = {}) => ({ id, title: `원고 ${id}`, folder: `${scripts.SCRIPT_DOCUMENT_ROOT}/영상`, source_ref: `${id}.md`, current_version: 1, status: "draft", updated_at: "2026-09-08T00:00:00Z", ...fields });
const childrenOf = (tree) => Array.isArray(tree) ? tree.flatMap(childrenOf) : tree && typeof tree === "object" ? [tree, ...childrenOf(tree.props?.children)] : [];

function setup(overrides = {}, initialSession = {}) {
  const hooks = [], effects = [], listCalls = [], readCalls = [], createCalls = [];
  let cursor = 0;
  let session = { demo: false, accessToken: "token", profile: { id: "one" }, ...initialSession };
  const api = {
    listDocuments: async (_token, query) => { listCalls.push(new URLSearchParams(query)); return overrides.list?.(query) ?? { documents: [], total: 0 }; },
    getDocument: async (_token, id) => { readCalls.push(id); return overrides.read?.(id) ?? { document: documentRow(id, { content_md: `본문 ${id}` }) }; },
    createDocument: async (_token, input) => { createCalls.push(input); return overrides.create?.(input) ?? { document: documentRow("new", { ...input, content_md: input.content }) }; },
  };
  const memo = (fn, deps) => {
    const index = cursor++;
    if (!hooks[index] || deps.some((dep, i) => !Object.is(dep, hooks[index].deps[i]))) hooks[index] = { deps, value: fn() };
    return hooks[index].value;
  };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { value: initial };
      return [hooks[index].value, (next) => { hooks[index].value = typeof next === "function" ? next(hooks[index].value) : next; }];
    },
    useRef: (initial) => memo(() => ({ current: initial }), []),
    useMemo: memo,
    useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect(fn, deps) {
      const index = cursor++;
      const old = hooks[index];
      if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) effects.push(() => {
        old?.cleanup?.(); hooks[index] = { deps, cleanup: fn() };
      });
    },
  };
  const jsx = (type, props) => ({ type, props });
  const modules = {
    react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "lucide-react": new Proxy({}, { get: (_target, name) => String(name) }),
    "@/lib/api-client": api, "@/lib/script-documents": scripts,
    "./session-provider": { useSession: () => session },
  };
  const mod = { exports: {} };
  runInNewContext(`(function(require, module, exports) { ${code}\n})`, {
    URLSearchParams, Error, HTMLElement: class {},
    document: { activeElement: null, addEventListener() {}, removeEventListener() {} },
    FormData: class { constructor(form) { this.fields = form.fields; } get(key) { return this.fields[key] ?? null; } },
  })((id) => { assert.ok(id in modules, id); return modules[id]; }, mod, mod.exports);
  const render = () => {
    cursor = 0;
    const tree = mod.exports.ContentScriptsWorkspace();
    while (effects.length) effects.shift()();
    return childrenOf(tree);
  };
  const open = () => {
    render().find((item) => item.type === "button" && item.props.children?.includes?.(" 새 원고 작성"))?.props.onClick();
    return render().find((item) => item.type === "form");
  };
  return {
    render, open, listCalls, readCalls, createCalls,
    setSession: (next) => { session = { ...session, ...next }; },
    submit: (form, fields = { title: "첫 원고", folderName: "영상", content: "" }) => form.props.onSubmit({ preventDefault() {}, currentTarget: { fields } }),
    unmount: () => hooks.forEach((hook) => hook.cleanup?.()),
  };
}

test("an empty script library can create its first draft and select the saved document", async () => {
  const app = setup();
  app.render(); await settle();
  const form = app.open();
  assert.ok(form, "empty state exposes a draft form");
  await app.submit(form);
  app.render(); await settle();
  const view = app.render();
  assert.equal(app.createCalls.length, 1);
  assert.equal(app.listCalls.length, 1, "a saved draft should not depend on a second list request");
  assert.equal(app.readCalls.at(-1), "new");
  assert.ok(view.some((item) => item.type === "a" && item.props.href === "/knowledge?document=new"));
  assert.equal(view.some((item) => item.type === "form"), false);
  app.unmount();
});

test("script lists retain all pages and load only the selected body", async () => {
  const app = setup({ list: (query) => {
    const offset = Number(new URLSearchParams(query).get("offset"));
    return { documents: Array.from({ length: offset ? 1 : 200 }, (_, index) => documentRow(String(offset + index + 1))), total: 201 };
  } });
  app.render(); await settle(); app.render(); await settle(); app.render();
  assert.deepEqual(app.listCalls.map((query) => query.get("offset")), ["0", "200"]);
  assert.ok(app.listCalls.every((query) => query.get("view") === "summary" && !query.get("statuses").includes("archived")));
  assert.equal(app.readCalls.length, 1);
  assert.equal(app.render().filter((item) => item.type === "button" && /^\d+\.md$/.test(item.props.children)).length, 201);
  app.unmount();
});

test("failed and double submissions preserve the editor and token refresh does not close it", async () => {
  let rejectSave;
  const app = setup({ create: () => new Promise((_resolve, reject) => { rejectSave = reject; }) });
  app.render(); await settle();
  const form = app.open();
  const first = app.submit(form);
  await app.submit(form);
  assert.equal(app.createCalls.length, 1);
  app.setSession({ accessToken: "refreshed-token" });
  app.render(); await settle();
  assert.ok(app.render().some((item) => item.type === "form"));
  rejectSave(new Error("저장 실패")); await first;
  const view = app.render();
  assert.ok(view.some((item) => item.props.role === "alert" && item.props.children === "저장 실패"));
  assert.ok(view.some((item) => item.type === "form"));
  assert.ok(view.filter((item) => item.type === "input").every((item) => !item.props.disabled));
  app.unmount();
});

test("demo scripts do not query or save operational documents", async () => {
  const app = setup({}, { demo: true, accessToken: null });
  app.render(); await settle();
  assert.equal(app.listCalls.length, 0);
  assert.equal(app.createCalls.length, 0);
  assert.ok(app.render().filter((item) => item.type === "button" && item.props.children?.includes?.(" 새 원고 작성")).every((item) => item.props.disabled));
  app.unmount();
});

test("account change during a save does not lock the new account or select the old draft", async () => {
  let finishOldSave;
  const app = setup({ create: () => new Promise((resolve) => { finishOldSave = resolve; }) });
  app.render(); await settle();
  const oldSave = app.submit(app.open());
  app.setSession({ accessToken: "other-token", profile: { id: "two" } });
  app.render(); await settle();
  const newForm = app.open();
  assert.ok(newForm);
  assert.ok(app.render().filter((item) => item.type === "input").every((item) => !item.props.disabled));
  finishOldSave({ document: documentRow("old-created") });
  await oldSave;
  assert.equal(app.render().some((item) => item.type === "a" && item.props.href?.includes("old-created")), false);
  assert.ok(app.render().some((item) => item.type === "form"));
  app.unmount();
});

test("archived script summaries are excluded and a selected-body failure can be retried", async () => {
  let fail = true;
  const app = setup({
    list: () => ({ documents: [documentRow("archived", { status: "archived" }), documentRow("active")], total: 2 }),
    read: () => { if (fail) throw new Error("본문 실패"); return { document: documentRow("active", { content_md: "복구된 본문" }) }; },
  });
  app.render(); await settle(); app.render(); await settle();
  const view = app.render();
  assert.deepEqual(app.readCalls, ["active"]);
  assert.ok(view.some((item) => item.props.role === "alert"));
  fail = false;
  view.find((item) => item.type === "button" && item.props.children === "다시 불러오기").props.onClick();
  app.render(); await settle();
  assert.ok(app.render().some((item) => item.type === "pre" && item.props.children === "복구된 본문"));
  app.unmount();
});
