import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../components/session-provider.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const turn = () => new Promise((resolve) => setTimeout(resolve, 5));
const session = (id, token = `${id}-token`) => ({ user: { id, email: `${id}@example.test` }, access_token: token });

// Exercise the provider's effect lifecycle with controlled auth/query timing,
// including navigation without remounting the persistent Next.js layout.
function setup() {
  const hooks = [], effects = [], queries = [], redirects = [];
  let cursor = 0, pathname = "/home", callback, subscriptions = 0, unsubscribes = 0, getSessions = 0;
  const router = { replace: (path) => redirects.push(path) };
  const client = {
    auth: {
      getSession: async () => { getSessions += 1; return { data: { session: null } }; },
      onAuthStateChange(fn) {
        subscriptions += 1;
        callback = fn;
        return { data: { subscription: { unsubscribe() { unsubscribes += 1; } } } };
      },
    },
    from(table) {
      assert.equal(table, "os_profiles");
      const query = {};
      const builder = {
        select() { return builder; },
        eq(column, id) { assert.equal(column, "id"); query.id = id; return builder; },
        abortSignal(signal) { query.signal = signal; return builder; },
        maybeSingle() {
          queries.push(query);
          return new Promise((resolve) => { query.resolve = resolve; });
        },
      };
      return builder;
    },
  };
  const react = {
    createContext: () => ({ Provider: "provider" }),
    useContext: () => null,
    useState(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { value: initial };
      return [hooks[index].value, (next) => {
        hooks[index].value = typeof next === "function" ? next(hooks[index].value) : next;
      }];
    },
    useMemo: (fn) => fn(),
    useEffect(fn, deps) {
      const index = cursor++;
      const old = hooks[index];
      if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) {
        effects.push(() => {
          old?.cleanup?.();
          hooks[index] = { deps, cleanup: fn() };
        });
      }
    },
  };
  const modules = {
    react,
    "react/jsx-runtime": { jsx: (_type, props) => props },
    "next/navigation": { useRouter: () => router, usePathname: () => pathname },
    "@/lib/supabase/client": { getBrowserSupabase: () => client },
  };
  const mod = { exports: {} };
  runInNewContext(`(function(require, module, exports) { ${code}\n})`, {
    AbortController, setTimeout, clearTimeout,
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://example.test", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-key" } },
  })((id) => {
    assert.ok(id in modules, `Unexpected module: ${id}`);
    return modules[id];
  }, mod, mod.exports);
  function render(path = pathname) {
    pathname = path;
    cursor = 0;
    const result = mod.exports.SessionProvider({ children: null });
    while (effects.length) effects.shift()();
    return result.value;
  }
  return {
    render, queries, redirects,
    emit: (event, value) => callback(event, value),
    counts: () => ({ subscriptions, unsubscribes, getSessions }),
    unmount: () => hooks.forEach((hook) => hook.cleanup?.()),
  };
}

test("initial auth events issue one profile query and navigation keeps one subscription", async () => {
  const app = setup();
  app.render();
  app.emit("INITIAL_SESSION", session("one"));
  app.emit("SIGNED_IN", session("one"));
  await turn();
  assert.equal(app.queries.length, 1);
  app.queries[0].resolve({ data: { display_name: "One", role: "member" } });
  await turn();
  assert.equal(app.render().profile.id, "one");
  for (const path of ["/knowledge", "/performance/revenue", "/tasks", "/home"]) app.render(path);
  await turn();
  assert.deepEqual(app.counts(), { subscriptions: 1, unsubscribes: 0, getSessions: 0 });
  assert.equal(app.queries.length, 1);
  app.unmount();
  assert.equal(app.counts().unsubscribes, 1);
});

test("sign-out clears identity immediately and ignores an older profile response", async () => {
  const app = setup();
  app.render();
  app.emit("INITIAL_SESSION", session("old"));
  await turn();
  const oldQuery = app.queries[0];
  app.emit("SIGNED_OUT", null);
  let state = app.render("/knowledge");
  assert.equal(state.session, null);
  assert.equal(state.profile, null);
  assert.equal(oldQuery.signal.aborted, true);
  oldQuery.resolve({ data: { role: "admin", display_name: "Old account" } });
  await turn();
  state = app.render();
  assert.equal(state.profile, null);
  assert.equal(state.loading, false);
  assert.equal(app.redirects.at(-1), "/login?next=%2Fknowledge");
  app.unmount();
});

test("account switches discard previous account profile even when its response arrives last", async () => {
  const app = setup();
  app.render();
  app.emit("INITIAL_SESSION", session("old"));
  await turn();
  app.emit("SIGNED_IN", session("new"));
  assert.equal(app.render().loading, true);
  assert.equal(app.render().profile, null);
  await turn();
  app.queries[1].resolve({ data: { display_name: "New account", role: "member", must_change_password: true } });
  await turn();
  app.queries[0].resolve({ data: { role: "admin", must_change_password: false } });
  await turn();
  const state = app.render();
  assert.equal(state.profile.id, "new");
  assert.equal(state.profile.role, "member");
  assert.equal(state.profile.mustChangePassword, true);
  assert.equal(state.accessToken, "new-token");
  app.unmount();
});

test("token refresh reloads current profile and cleanup cancels its outstanding query", async () => {
  const app = setup();
  app.render();
  app.emit("INITIAL_SESSION", session("one"));
  await turn();
  app.queries[0].resolve({ data: { role: "member" } });
  await turn();
  app.emit("TOKEN_REFRESHED", session("one", "new-token"));
  assert.equal(app.render().loading, false, "same-account refresh must not remount page workspaces");
  await turn();
  assert.equal(app.queries.length, 2);
  assert.equal(app.render().accessToken, "new-token");
  app.unmount();
  assert.equal(app.queries[1].signal.aborted, true);
  app.queries[1].resolve({ data: { role: "admin" } });
  await turn();
});

test("a missing initial session redirects without issuing an anonymous profile query", async () => {
  const app = setup();
  app.render("/tasks");
  app.emit("INITIAL_SESSION", null);
  app.render();
  await turn();
  assert.equal(app.queries.length, 0);
  assert.equal(app.redirects.at(-1), "/login?next=%2Ftasks");
  app.unmount();
});
