import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../components/use-menu-access.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
const profile = id => ({ id, role: "member", isActive: true, financeAccess: false });

function setup() {
  const hooks = [], effects = [], requests = [], listeners = new Map();
  let cursor = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      hooks[index] ??= { value: initial };
      return [hooks[index].value, next => { hooks[index].value = typeof next === "function" ? next(hooks[index].value) : next; }];
    },
    useEffect(fn, deps) {
      const index = cursor++, old = hooks[index];
      if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) effects.push(() => {
        old?.cleanup?.();
        hooks[index] = { deps, cleanup: fn() };
      });
    },
  };
  const modules = { react, "@/lib/api-client": { getMenuAccess(token) {
    const request = { token };
    requests.push(request);
    return new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
  } } };
  const mod = { exports: {} };
  runInNewContext(`(function(require,module,exports) { ${code}\n})`, {
    Error,
    window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); } },
  })(name => { assert.ok(name in modules, name); return modules[name]; }, mod, mod.exports);
  return {
    requests,
    render(member = profile("one"), token = "one-token", demo = false, path = "/home") {
      cursor = 0;
      const result = mod.exports.useMenuAccess(member, token, demo, path);
      while (effects.length) effects.shift()();
      return result;
    },
    focus: () => listeners.get("focus")?.(),
    unmount: () => hooks.forEach(hook => hook.cleanup?.()),
  };
}

test("route changes reuse the policy and account switches discard old responses", async () => {
  const app = setup();
  assert.equal(app.render().loading, true);
  app.requests[0].resolve({ policies: [{ member_id: "one", allowed_menus: ["/home"] }], ready: true });
  await turn();
  assert.equal(app.render().loading, false);
  assert.deepEqual(Array.from(app.render().allowed), ["/home"]);
  assert.equal(app.render(profile("one"), "one-token", false, "/knowledge").loading, false);
  assert.equal(app.requests.length, 1);
  app.focus();
  assert.equal(app.render(profile("two"), "two-token", false, "/knowledge").loading, true);
  app.requests[2].resolve({ policies: [{ member_id: "two", allowed_menus: ["/knowledge"] }], ready: true });
  app.requests[1].resolve({ policies: [{ member_id: "one", allowed_menus: null }], ready: true });
  await turn();
  const result = app.render(profile("two"), "two-token", false, "/knowledge");
  assert.equal(result.loading, false);
  assert.deepEqual(Array.from(result.allowed), ["/knowledge"]);
  app.unmount();
});

test("vault folder query changes keep the approved workspace mounted", async () => {
  const app = setup();
  assert.equal(app.render(profile("one"), "one-token", false, "/knowledge/vault").loading, true);
  app.requests[0].resolve({ policies: [{ member_id: "one", allowed_menus: ["/knowledge/vault"] }], ready: true });
  await turn();
  const folder = app.render(profile("one"), "one-token", false, "/knowledge/vault?folder=02_Wiki");
  assert.equal(folder.loading, false);
  assert.deepEqual(Array.from(folder.allowed), ["/knowledge/vault"]);
  assert.equal(app.requests.length, 1, "query-only navigation must not refetch menu policy");
  app.unmount();
});

test("focus and token refresh preserve mounted forms, latest response wins, failures are closed and retryable", async () => {
  const app = setup();
  app.render();
  app.requests[0].resolve({ policies: [], ready: false });
  await turn();
  assert.equal(app.render().allowed, null, "code-first deployment keeps legacy menus until the additive table exists");
  app.focus();
  assert.equal(app.render().loading, false, "background focus must not unmount page inputs");
  app.render(profile("one"), "refreshed-token");
  assert.equal(app.render(profile("one"), "refreshed-token").loading, false);
  app.requests[2].resolve({ policies: [{ member_id: "one", allowed_menus: ["/home"] }], ready: true });
  app.requests[1].resolve({ policies: [{ member_id: "one", allowed_menus: null }], ready: true });
  await turn();
  assert.deepEqual(Array.from(app.render(profile("one"), "refreshed-token").allowed), ["/home"]);
  app.focus();
  app.requests[3].reject(new Error("Settings temporarily unavailable"));
  await turn();
  const failed = app.render(profile("one"), "refreshed-token");
  assert.deepEqual(Array.from(failed.allowed), []);
  assert.match(failed.error, /unavailable/);
  failed.retry();
  app.render(profile("one"), "refreshed-token");
  assert.equal(app.render(profile("one"), "refreshed-token").loading, true);
  app.requests[4].resolve({ policies: [], ready: true });
  await turn();
  assert.equal(app.render(profile("one"), "refreshed-token").error, "");
  app.unmount();
});

test("admin and offline demo do not fetch, cleanup ignores a pending response", async () => {
  const app = setup();
  assert.equal(app.render({ ...profile("admin"), role: "admin" }).loading, false);
  assert.equal(app.render(profile("one"), null, true).loading, false);
  assert.equal(app.requests.length, 0);
  app.render();
  app.unmount();
  app.requests[0].resolve({ policies: [], ready: true });
  await turn();
  assert.equal(app.render().loading, true);
});
