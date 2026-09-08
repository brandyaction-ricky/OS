import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../components/project-hub-workspace.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const projects = ["os", "edu", "myin"].map((id) => ({ id, title: id, description: id, metadata: {} }));
const counts = { backlog: 0, active: 0, review: 0, done: 0, blocked: 0 };

// Keep the workspace mounted while changing URL parameters and invoking its actual controls.
// Controlled hooks make asynchronous query/effect order observable without a live account.
function setup(initialQuery = "", { delayProjects = false } = {}) {
  const hooks = [], effects = [], queries = [];
  let cursor = 0, query = initialQuery, dirty = true, tree, resolveProjects;
  const projectPromise = delayProjects ? new Promise((resolve) => { resolveProjects = resolve; }) : Promise.resolve({ records: projects, total: projects.length });
  const changed = (previous, next) => !previous || next.some((value, index) => !Object.is(value, previous[index]));
  const memo = (fn, deps) => {
    const index = cursor++;
    if (changed(hooks[index]?.deps, deps)) hooks[index] = { deps, value: fn() };
    return hooks[index].value;
  };
  const react = {
    Suspense: "suspense",
    useState(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { value: typeof initial === "function" ? initial() : initial };
      return [hooks[index].value, (next) => {
        const value = typeof next === "function" ? next(hooks[index].value) : next;
        if (!Object.is(hooks[index].value, value)) { hooks[index].value = value; dirty = true; }
      }];
    },
    useRef: (initial) => memo(() => ({ current: initial }), []),
    useMemo: memo,
    useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect(fn, deps) {
      const index = cursor++;
      const previous = hooks[index];
      if (changed(previous?.deps, deps)) effects.push(() => {
        previous?.cleanup?.();
        hooks[index] = { deps, cleanup: fn() };
      });
    },
  };
  const jsx = (type, props) => ({ type, props });
  const events = new EventTarget();
  const modules = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "lucide-react": new Proxy({}, { get: (_target, name) => name }),
    "next/navigation": { useSearchParams: () => new URLSearchParams(query) },
    "@/lib/api-client": {
      listRecords: async (_token, type) => type === "project" ? projectPromise : { records: [], total: 0 },
      createRecord: async () => { throw new Error("Unexpected write"); },
    },
    "@/lib/development-handoff": {
      recordText: (record, key) => record?.metadata?.[key] ?? "",
      repositoryUrl: () => null,
      safeWebUrl: () => null,
    },
    "./session-provider": { useSession: () => ({ accessToken: "test-session", demo: false, loading: false, profile: { id: "reporter", role: "admin" } }) },
    "./development-workspace.css": {},
    "./development-project-overview": { DevelopmentProjectOverview: "overview" },
  };
  const mod = { exports: {} };
  runInNewContext(`(function(require, module, exports) { ${code}\n})`, {
    URLSearchParams, console, Event, clearInterval() {},
    window: { location: { origin: "https://os.example" }, setInterval: () => 1, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events) },
    document: { visibilityState: "visible", body: { style: {} }, activeElement: null },
    fetch: async (url) => {
      const params = new URL(url, "https://os.example").searchParams;
      queries.push(Object.fromEntries(params));
      return { ok: true, json: async () => ({ requests: [], total: 0, counts }) };
    },
  })((name) => {
    assert.ok(name in modules, `Unexpected module ${name}`);
    return modules[name];
  }, mod, mod.exports);
  const content = mod.exports.ProjectHubWorkspace().props.children.type;
  function render() {
    cursor = 0; dirty = false;
    tree = content();
    while (effects.length) effects.shift()();
  }
  async function flush() {
    for (let i = 0; i < 40; i += 1) {
      if (dirty) render();
      await new Promise((resolve) => setImmediate(resolve));
      if (!dirty) return;
    }
    throw new Error("Workspace did not settle");
  }
  function find(predicate) {
    const visit = (node) => {
      if (Array.isArray(node)) return node.flatMap(visit);
      if (!node || typeof node !== "object" || !node.props) return [];
      return [...(predicate(node) ? [node] : []), ...visit(node.props.children)];
    };
    const result = visit(tree)[0];
    assert.ok(result, "Control not found");
    return result;
  }
  return {
    flush, queries, find,
    navigate: (next) => { query = next; dirty = true; },
    renderAgain: () => { dirty = true; },
    resolveProjects: () => resolveProjects({ records: projects, total: projects.length }),
    unmount: () => hooks.forEach((hook) => hook.cleanup?.()),
  };
}

const selector = (app) => app.find((node) => node.props["aria-label"] === "개발 프로젝트 선택");
const buttonText = (node) => Array.isArray(node.props.children) ? node.props.children.find((value) => typeof value === "string") : node.props.children;

test("same-page project links switch the selected project after the initial load", async () => {
  const app = setup("project=os&status=review&scope=mine");
  await app.flush();
  assert.equal(selector(app).props.value, "os");
  app.navigate("project=edu&status=active");
  await app.flush();
  assert.equal(selector(app).props.value, "edu");
  assert.equal(app.queries.at(-1).projectId, "edu");
  assert.equal(app.queries.at(-1).status, "active");
  assert.equal(app.queries.at(-1).scope, undefined);
  app.unmount();
});

test("removing URL filters clears them while unchanged URL rerenders preserve manual filters", async () => {
  const app = setup("project=os&status=review&scope=mine");
  await app.flush();
  app.navigate("project=os");
  await app.flush();
  assert.equal(app.queries.at(-1).status, undefined);
  assert.equal(app.queries.at(-1).scope, undefined);
  app.find((node) => node.type === "button" && buttonText(node) === "접수").props.onClick();
  await app.flush();
  assert.equal(app.queries.at(-1).status, "backlog");
  selector(app).props.onChange({ target: { value: "myin" } });
  await app.flush();
  app.renderAgain();
  await app.flush();
  assert.equal(selector(app).props.value, "myin");
  assert.equal(app.queries.at(-1).status, "backlog");
  app.unmount();
});

test("URL changes during project loading use the newest project and ignore unknown projects", async () => {
  const app = setup("project=os", { delayProjects: true });
  await app.flush();
  app.navigate("project=edu");
  await app.flush();
  app.resolveProjects();
  await app.flush();
  assert.equal(selector(app).props.value, "edu");
  app.navigate("project=unavailable&status=unknown&scope=other");
  await app.flush();
  assert.equal(selector(app).props.value, "edu");
  assert.equal(app.queries.at(-1).status, undefined);
  assert.equal(app.queries.at(-1).scope, undefined);
  app.unmount();
});


test("overview is the default and project cards open only their scoped requests", async () => {
  const app = setup();
  await app.flush();
  assert.equal(selector(app).props.value, "");
  assert.equal(app.queries.length, 0);
  const overview = app.find(node => node.type === "overview");
  assert.equal(overview.props.projects.length, 3);
  overview.props.onChoose("edu", "blocked");
  await app.flush();
  assert.equal(app.queries.at(-1).projectId, "edu");
  assert.equal(app.queries.at(-1).status, "blocked");
  app.find(node => node.type === "button" && buttonText(node) === "전체 현황").props.onClick();
  await app.flush();
  assert.equal(selector(app).props.value, "");
  assert.ok(app.find(node => node.type === "overview"));
  app.unmount();
});


test("notification links without a project load the cross-project personal request list", async () => {
  const app = setup("scope=mine&status=review");
  await app.flush();
  assert.equal(app.queries.at(-1).scope, "mine");
  assert.equal(app.queries.at(-1).status, "review");
  assert.equal(app.queries.at(-1).projectId, undefined);
  app.unmount();
});

test("employees can open a dedicated feature request with a file attachment", async () => {
  const app = setup("project=os");
  await app.flush();
  const button = app.find((node) => node.type === "button" && Array.isArray(node.props.children) && node.props.children.some((value) => typeof value === "string" && value.includes("추가 개발 요청")));
  button.props.onClick();
  await app.flush();
  assert.equal(app.find((node) => node.type === "select" && node.props.name === "category").props.defaultValue, "feature");
  assert.equal(app.find((node) => node.type === "input" && node.props.name === "attachment").props.type, "file");
  assert.doesNotMatch(source, /name="steps"|스크린샷·영상 링크|재현 순서/);
  app.unmount();
});
