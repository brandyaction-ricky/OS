import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../components/development-request-notifications.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
function setup() {
  const hooks = [], effects = [], calls = [], timers = new Map(), listeners = new Map();
  let cursor = 0, timerId = 0, session = { accessToken: "fixture-token", profile: { id: "fixture", role: "admin" }, demo: false, loading: false };
  const same = (a, b) => a && a.length === b.length && b.every((value, i) => Object.is(value, a[i]));
  const react = {
    useState(initial) {
      const index = cursor++; hooks[index] ??= { value: initial };
      return [hooks[index].value, value => { hooks[index].value = typeof value === "function" ? value(hooks[index].value) : value; }];
    },
    useRef(initial) { const index = cursor++; hooks[index] ??= { current: initial }; return hooks[index]; },
    useId: () => "fixture-notifications",
    useCallback(fn, deps) { const index = cursor++; if (!same(hooks[index]?.deps, deps)) hooks[index] = { fn, deps }; return hooks[index].fn; },
    useEffect(fn, deps) {
      const index = cursor++, old = hooks[index];
      if (!same(old?.deps, deps)) effects.push(() => { old?.cleanup?.(); hooks[index] = { deps, cleanup: fn() }; });
    },
  };
  const onOpenChange = () => {}, router = { push() {} };
  const events = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); } };
  const modules = {
    react, "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    "lucide-react": {}, "next/link": {}, "next/navigation": { useRouter: () => router },
    "@/lib/development-status": { developmentStatusLabel: status => status }, "@/lib/notifications": { NOTIFICATION_REASONS: {} },
    "./session-provider": { useSession: () => session }, "./development-notifications.css": {},
  };
  const mod = { exports: {} };
  runInNewContext(code, {
    module: mod, exports: mod.exports, require: name => { assert.ok(name in modules, name); return modules[name]; },
    AbortController, URLSearchParams, Date,
    window: { ...events, setInterval: fn => { timers.set(++timerId, fn); return timerId; }, clearInterval: id => timers.delete(id) },
    document: { ...events, visibilityState: "visible" },
    fetch(path, options) { return new Promise(resolve => calls.push({ path, options, reply: (body, status = 200) => resolve(Response.json(body, { status })) })); },
  });
  return {
    calls,
    render(open = false) { cursor = 0; const result = mod.exports.DevelopmentRequestNotifications({ open, onOpenChange }); while (effects.length) effects.shift()(); return result; },
    tick: () => [...timers.values()].forEach(fn => fn()),
    switchAccount: () => { session = { ...session, profile: { id: "other", role: "member" }, accessToken: "other-token" }; },
    unmount: () => hooks.forEach(hook => hook.cleanup?.()),
  };
}
function label(tree) {
  if (!tree || typeof tree !== "object") return null;
  if (Array.isArray(tree)) return tree.map(label).find(Boolean);
  if (tree.props?.["aria-label"]?.startsWith("알림")) return tree.props["aria-label"];
  return label(tree.props?.children);
}
function replyNotifications(calls) {
  for (const call of calls) {
    if (call.path === "/api/v1/development-notifications") call.reply({ notifications: [], unread: 2, truncated: false });
    if (call.path === "/api/v1/notifications") call.reply({ notifications: [], unread: 3, truncated: false });
  }
}
const summary = { requests: [], total: 0, counts: { backlog: 0, active: 0, review: 0, blocked: 0, done: 0 }, canManage: true };

test("closed notification panels poll unread counts without fetching development requests", async () => {
  const app = setup(); app.render();
  assert.deepEqual(app.calls.map(call => call.path), ["/api/v1/development-notifications", "/api/v1/notifications"]);
  replyNotifications(app.calls); await turn();
  assert.equal(label(app.render()), "알림, 읽지 않음 5건");
  app.tick(); assert.equal(app.calls.length, 4);
  assert.ok(app.calls.every(call => !call.path.startsWith("/api/v1/development-requests")));
  replyNotifications(app.calls.slice(2)); await turn();
  assert.equal(label(app.render()), "알림, 읽지 않음 5건"); app.unmount();
});

test("opening fetches request details, while a failed summary does not erase the unread badge", async () => {
  const app = setup(); app.render(); replyNotifications(app.calls); await turn();
  app.render(true);
  const opened = app.calls.slice(2);
  assert.equal(opened.length, 3);
  assert.match(opened[0].path, /development-requests\?summary=1/);
  opened[0].reply({ error: { message: "temporary summary failure" } }, 503);
  replyNotifications(opened); await turn();
  assert.equal(label(app.render(true)), "알림, 읽지 않음 5건");
  app.tick(); const retry = app.calls.slice(5); retry[0].reply(summary); replyNotifications(retry); await turn();
  assert.equal(label(app.render(true)), "알림, 읽지 않음 5건"); app.unmount();
});

test("account switches discard older pending badge responses", async () => {
  const app = setup(); app.render();
  const old = app.calls.slice(); app.switchAccount(); app.render();
  assert.ok(old.every(call => call.options.signal.aborted));
  replyNotifications(old); await turn();
  assert.equal(label(app.render()), "알림");
  app.calls[2].reply({ notifications: [], unread: 0 }); app.calls[3].reply({ notifications: [], unread: 0 }); await turn();
  assert.equal(label(app.render()), "알림, 읽지 않음 0건"); app.unmount();
});
