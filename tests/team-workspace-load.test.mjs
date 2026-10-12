import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Execute the component's effects with stable hook slots, without a browser or live records.
function workspace({ hold = Promise.resolve(), readResult = (_, result) => result } = {}) {
  const slots = [], pending = [], calls = [];
  let cursor = 0, params = new URLSearchParams();
  let session = { accessToken: "synthetic-token", demo: false, loading: false, profile: { id: "synthetic", role: "admin", isActive: true } };
  const changed = (before, after) => !before || before.length !== after.length || after.some((value, i) => !Object.is(value, before[i]));
  function memo(factory, deps) {
    const at = cursor++, previous = slots[at];
    if (!previous || changed(previous.deps, deps)) slots[at] = { deps, value: factory() };
    return slots[at].value;
  }
  const react = {
    useState(initial) {
      const at = cursor++;
      if (!(at in slots)) slots[at] = typeof initial === "function" ? initial() : initial;
      return [slots[at], value => { slots[at] = typeof value === "function" ? value(slots[at]) : value; }];
    },
    useRef(initial) {
      const at = cursor++;
      if (!(at in slots)) slots[at] = { current: initial };
      return slots[at];
    },
    useCallback: (fn, deps) => memo(() => fn, deps), useMemo: memo,
    useEffect(fn, deps) {
      const at = cursor++, previous = slots[at];
      if (!previous || changed(previous.deps, deps)) {
        const next = { deps, cleanup: undefined }; slots[at] = next;
        pending.push(() => { previous?.cleanup?.(); next.cleanup = fn(); });
      }
    },
  };
  async function read(kind, result, token) { calls.push(kind); await hold; return readResult(kind, result, token); }
  const imports = {
    react, "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    "next/navigation": { useSearchParams: () => params },
    "@/components/session-provider": { useSession: () => session },
    "@/components/workspace-load-state": { WorkspaceLoadState: "WorkspaceLoadState" },
    "@/lib/api-client": {
      listAllRecordsOfType: (token, kind) => read(kind, [], token), listMembers: token => read("members", { members: [] }, token),
      apiRequest: (path, { token }) => read(path, path.includes("absences") ? { absences: [] } : { meetings: [] }, token),
    },
    "@/lib/team/client": { listTeamRange: (token, kind, from, to) => read(`${kind}:${from}:${to}`, [], token) },
    "@/lib/team/decisions": { teamDecisions: () => [] },
    "@/lib/content-origin": { contentOrigin: () => "own" },
  };
  const exports = {}, noopModule = new Proxy({}, { get: () => () => null });
  const source = readFileSync(new URL("../components/team/team-workspace-v1.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(code, { exports, require: name => imports[name] ?? noopModule });
  return {
    calls,
    setSession(next) { session = { ...session, ...next }; },
    render(section, query = "") {
      params = new URLSearchParams(query); cursor = 0;
      const tree = exports.TeamWorkspaceV1({ section });
      for (const effect of pending.splice(0)) effect();
      return tree;
    },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
    settle: () => new Promise(resolve => setImmediate(resolve)),
  };
}

function propsOf(tree, name) {
  if (!tree) return undefined;
  if (Array.isArray(tree)) return tree.map(child => propsOf(child, name)).find(Boolean);
  if (tree.type === name || tree.type?.name === name) return tree.props;
  return propsOf(tree.props?.children, name);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("meeting selections, tabs and task filters reuse loaded data", async () => {
  const meetings = workspace();
  meetings.render("meetings"); await meetings.settle();
  assert.equal(meetings.calls.length, 5);
  for (const query of ["tab=decisions", "tab=prep", "meeting=synthetic", "f=done", "meeting=synthetic&step=review"]) {
    meetings.render("meetings", query); await meetings.settle();
  }
  assert.equal(meetings.calls.length, 5);
  const tasks = workspace();
  tasks.render("tasks"); await tasks.settle();
  assert.equal(tasks.calls.length, 4);
  for (const query of ["view=board", "view=inbox", "task=synthetic", "owner=synthetic", "mine=requested"]) {
    tasks.render("tasks", query); await tasks.settle();
  }
  assert.equal(tasks.calls.length, 4);
});

test("schedule loads absences alongside other requests and only reloads when its range changes", async () => {
  let release;
  const screen = workspace({ hold: new Promise(resolve => { release = resolve; }) });
  screen.render("schedule", "week=2026-10-12&view=week");
  assert.equal(screen.calls.length, 4);
  assert.ok(screen.calls.some(call => call.startsWith("/api/v1/hr/absences?")), "absence request starts before other data resolves");
  release(); await screen.settle();
  screen.render("schedule", "week=2026-10-12&view=week&task=synthetic"); await screen.settle();
  assert.equal(screen.calls.length, 4);
  screen.render("schedule", "week=2026-10-19&view=week"); await screen.settle();
  assert.equal(screen.calls.length, 8);
  screen.render("schedule", "week=2026-10-19&view=month"); await screen.settle();
  assert.equal(screen.calls.length, 12);
});

test("a slow previous schedule range cannot overwrite the current range", async () => {
  const earlier = deferred(), latest = deferred();
  const screen = workspace({ readResult: (kind, result) => kind.startsWith("task:") ? (kind.includes("2026-10-12") ? earlier.promise : latest.promise) : result });
  const previousRetry = propsOf(screen.render("schedule", "week=2026-10-12"), "WorkspaceLoadState").retry;
  screen.render("schedule", "week=2026-10-19");
  previousRetry();
  assert.equal(screen.calls.length, 8, "an old save/retry callback cannot invalidate the current load");
  latest.resolve([{ id: "latest", title: "latest" }]); await screen.settle();
  let tree = screen.render("schedule", "week=2026-10-19");
  assert.equal(propsOf(tree, "ScheduleView").tasks[0].id, "latest");
  assert.equal(propsOf(tree, "WorkspaceLoadState").loading, false);
  earlier.resolve([{ id: "earlier", title: "earlier" }]); await screen.settle();
  tree = screen.render("schedule", "week=2026-10-19");
  assert.equal(propsOf(tree, "ScheduleView").tasks[0].id, "latest");
});

test("an obsolete request failure cannot end or fail the current load", async () => {
  const earlier = deferred(), latest = deferred();
  const screen = workspace({ readResult: (kind, result) => kind.startsWith("task:") ? (kind.includes("2026-10-12") ? earlier.promise : latest.promise) : result });
  screen.render("schedule", "week=2026-10-12");
  screen.render("schedule", "week=2026-10-19");
  earlier.reject(new Error("obsolete range")); await screen.settle();
  let tree = screen.render("schedule", "week=2026-10-19");
  assert.equal(propsOf(tree, "WorkspaceLoadState").loading, true);
  assert.equal(propsOf(tree, "WorkspaceLoadState").error, "");
  latest.resolve([]); await screen.settle();
  tree = screen.render("schedule", "week=2026-10-19");
  assert.equal(propsOf(tree, "WorkspaceLoadState").loading, false);
  assert.equal(propsOf(tree, "WorkspaceLoadState").error, "");
});

test("account and permission changes immediately hide old data and reject old requests", async () => {
  const obsolete = deferred(), current = deferred();
  let firstRead = true;
  const screen = workspace({ readResult: (kind, result, token) => {
    if (!kind.startsWith("task:")) return result;
    if (token === "new-token") return current.promise;
    if (firstRead) { firstRead = false; return [{ id: "old-account", title: "old" }]; }
    return obsolete.promise;
  } });
  screen.render("schedule", "week=2026-10-12"); await screen.settle();
  assert.equal(propsOf(screen.render("schedule", "week=2026-10-12"), "ScheduleView").tasks[0].id, "old-account");
  screen.render("schedule", "week=2026-10-19");
  screen.setSession({ accessToken: "new-token", profile: { id: "new-account", role: "member", isActive: true } });
  let tree = screen.render("schedule", "week=2026-10-19");
  assert.equal(propsOf(tree, "ScheduleView").tasks.length, 0);
  obsolete.resolve([{ id: "late-old-account", title: "late" }]); await screen.settle();
  tree = screen.render("schedule", "week=2026-10-19");
  assert.equal(propsOf(tree, "ScheduleView").tasks.length, 0);
  assert.equal(propsOf(tree, "WorkspaceLoadState").loading, true);
  current.resolve([{ id: "new-account", title: "new" }]); await screen.settle();
  tree = screen.render("schedule", "week=2026-10-19");
  assert.equal(propsOf(tree, "ScheduleView").tasks[0].id, "new-account");
  const before = screen.calls.length;
  screen.setSession({ profile: { id: "new-account", role: "member", isActive: false } });
  tree = screen.render("schedule", "week=2026-10-19");
  assert.equal(propsOf(tree, "ScheduleView").tasks.length, 0);
  assert.equal(screen.calls.length, before, "disabled account does not start another read");
});
