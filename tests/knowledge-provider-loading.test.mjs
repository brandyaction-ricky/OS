import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as model from "../lib/knowledge/model.ts";

const actor = { ownerId: "synthetic-user", type: "user", role: "member", memberKind: "staff", active: true, allowedStatuses: ["draft", "team", "canonical"] };
const canon = { documents: [{ id: "canonical", title: "기준", folder: "규칙", current_version: 1, updated_at: "2026-10-12T00:00:00Z" }], people: [], proposalDocumentIds: [], actor };
const workspace = () => ({ state: model.emptyKnowledgeState(), actor, schemaReady: true });
const turn = () => new Promise(resolve => setTimeout(resolve, 0));

// Controlled hook lifecycle verifies that a persistent Next layout never treats
// a partial canon response as a complete document/meeting/editor workspace.
function setup(recent = {}) {
  const hooks = [], effects = [], requests = [], listeners = new Map();
  let cursor = 0, pathname = "/knowledge/canon";
  const profile = { id: actor.ownerId, role: "member", isActive: true };
  const react = {
    createContext: () => ({ Provider: "provider" }), useContext: () => null,
    useState(initial) { const index = cursor++; if (!hooks[index]) hooks[index] = { value: typeof initial === "function" ? initial() : initial }; return [hooks[index].value, next => { hooks[index].value = typeof next === "function" ? next(hooks[index].value) : next; }]; },
    useRef(value) { const index = cursor++; if (!hooks[index]) hooks[index] = { current: value }; return hooks[index]; },
    useMemo(fn) { return fn(); },
    useCallback(fn) { return fn; },
    useEffect(fn, deps) { const index = cursor++, old = hooks[index]; if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) effects.push(() => { old?.cleanup?.(); hooks[index] = { deps, cleanup: fn() }; }); },
  };
  const modules = {
    react, "react/jsx-runtime": { jsx: (_type, props) => props, jsxs: (_type, props) => props },
    "next/navigation": { usePathname: () => pathname },
    "@/components/session-provider": { useSession: () => ({ profile, accessToken: "synthetic-token", demo: false, loading: false }) },
    "@/lib/api-client": { apiRequest: (path, options) => new Promise((resolve, reject) => requests.push({ path, options, resolve, reject })), recentRead: path => recent[path] },
    "@/lib/knowledge/demo": {}, "@/lib/knowledge/model": model, "./shortcuts": { KnowledgeShortcuts: () => null },
  };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("../components/knowledge/provider.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(code, { exports, require: name => { assert.ok(name in modules, name); return modules[name]; }, setTimeout, clearTimeout,
    window: { addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) },
  });
  return {
    requests,
    render(path = pathname) { pathname = path; cursor = 0; const result = exports.KnowledgeProvider({ children: null }); while (effects.length) effects.shift()(); return result.value; },
    focus: () => listeners.get("focus")?.(),
  };
}

test("first canon visit loads only its summary and full workspace starts on another menu", async () => {
  const app = setup();
  assert.equal(app.render().loading, true);
  assert.deepEqual(app.requests.map(request => request.path), ["/api/v1/knowledge/canon"]);
  app.requests[0].resolve(canon); await turn();
  let value = app.render();
  assert.equal(value.loading, false); assert.equal(value.workspaceReady, false); assert.equal(value.canonList.documents.length, 1);
  assert.equal(app.requests.length, 1, "the hidden full workspace must not compete with the first canon request");
  value = app.render("/knowledge/docs");
  assert.equal(value.loading, true, "canonical summaries cannot be mistaken for all documents");
  assert.equal(app.requests[1].path, "/api/v1/knowledge/workspace");
  app.requests[1].resolve(workspace()); await turn();
  value = app.render();
  assert.equal(value.loading, false); assert.equal(value.workspaceReady, true);
});

test("shortcuts can lazily request their complete documents and meeting choices", async () => {
  const app = setup(); app.render(); app.requests[0].resolve(canon); await turn();
  const value = app.render(), pending = value.ensureWorkspace();
  assert.equal(app.requests[1].path, "/api/v1/knowledge/workspace");
  assert.equal(app.render().loading, false, "the visible canon list stays usable while shortcuts hydrate");
  app.requests[1].resolve(workspace()); await pending;
  assert.equal(app.render().workspaceReady, true);
  await app.render().ensureWorkspace();
  assert.equal(app.requests.length, 2, "opening shortcuts again reuses the complete in-memory state");
});

test("a late response from a previous route cannot overwrite the active scope", async () => {
  const app = setup(); app.render(); app.render("/knowledge/docs");
  app.requests[1].resolve(workspace()); await turn();
  app.requests[0].resolve(canon); await turn();
  const value = app.render();
  assert.equal(value.workspaceReady, true); assert.equal(value.canonList, null);
});

test("permission failure clears a prior canon snapshot and remains retryable", async () => {
  const app = setup(); app.render(); app.requests[0].resolve(canon); await turn(); app.render();
  app.focus(); app.requests[1].reject(new Error("권한을 확인해 주세요.")); await turn();
  const value = app.render();
  assert.equal(value.loading, false); assert.equal(value.canonList, null); assert.equal(value.workspaceReady, false);
  assert.ok(value.error);
  const retry = value.refresh(); app.requests[2].resolve(canon); await retry;
  assert.equal(app.render().error, "");
});

test("a canon focus refresh cannot cancel an open shortcut's full workspace read", async () => {
  const app = setup(); app.render(); app.requests[0].resolve(canon); await turn();
  const pending = app.render().ensureWorkspace();
  app.focus();
  assert.equal(app.requests[1].path, "/api/v1/knowledge/workspace");
  assert.equal(app.requests[2].path, "/api/v1/knowledge/canon");
  app.requests[2].resolve(canon); await turn();
  app.requests[1].resolve(workspace()); await pending;
  assert.equal(app.render().workspaceReady, true);
});

test("meeting list does not eagerly read the unrelated document workspace", async () => {
  const app = setup();
  const value = app.render("/knowledge/meetings");
  assert.equal(value.loading, false, "meeting component owns its list loading and error state");
  assert.equal(value.workspaceReady, false);
  assert.equal(app.requests.length, 0);
  const pending = value.ensureWorkspace();
  assert.equal(app.requests[0].path, "/api/v1/knowledge/workspace");
  app.requests[0].resolve(workspace()); await pending;
  assert.equal(app.render().workspaceReady, true);
});

test("saving one meeting refreshes its record without downloading the document workspace", async () => {
  const app = setup();
  const value = app.render("/knowledge/meetings");
  const pending = value.command({ action: "meeting.save", id: "synthetic-meeting", expectedVersion: 1 });
  await turn(); assert.equal(app.requests[0].options.method, "POST");
  app.requests[0].resolve({ id: "synthetic-meeting" }); await turn();
  assert.equal(app.requests[1].path, "/api/v1/knowledge/meetings/synthetic-meeting");
  app.requests[1].resolve({ meeting: { id: "synthetic-meeting", version: 2 }, people: [], actor }); await pending;
  assert.equal(app.requests.length, 2);
  assert.equal(app.render().state.meetings[0].version, 2);
});

test("a revisit shows the remembered list at once, but editors wait for the fresh workspace", async () => {
  const app = setup({ "/api/v1/knowledge/canon": canon, "/api/v1/knowledge/workspace": workspace() });
  app.render(); let value = app.render();
  assert.equal(value.loading, false, "the remembered canon list renders before the network answers");
  assert.equal(value.canonList.documents.length, 1);
  assert.deepEqual(app.requests.map(request => request.path), ["/api/v1/knowledge/canon"], "a fresh read still runs");
  app.render("/knowledge/notes"); value = app.render();
  assert.equal(value.loading, false); assert.equal(value.workspaceReady, true);
  assert.equal(value.draftsReady, false, "remembered drafts never open an editor");
  app.requests[1].resolve(workspace()); await turn();
  assert.equal(app.render().draftsReady, true);
});
