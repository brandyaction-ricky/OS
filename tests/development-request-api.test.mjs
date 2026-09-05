import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as zod from "zod";
import * as requests from "../lib/development-requests.ts";

const projectId = "80950395-23b2-4b5a-bd0f-c3d8b8b78d92";
const requestId = "28e1749d-92b9-476b-a17c-eb5be59d2822";
const source = await readFile(new URL("../app/api/v1/development-requests/route.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function createDatabase(rows) {
  return {
    from(table) {
      assert.equal(table, "os_records");
      const conditions = [];
      let action = "read", fields, head = false, range;
      const value = (row, key) => key === "metadata->>kind" ? row.metadata?.kind : row[key];
      const execute = () => {
        let matches = rows.filter((row) => conditions.every((matchesRow) => matchesRow(row)));
        if (action === "insert") {
          const row = { ...structuredClone(fields), id: requestId, version: 1, archived_at: null, created_at: "2026-09-05T12:00:00Z", updated_at: "2026-09-05T12:00:00Z" };
          rows.push(row); matches = [row];
        } else if (action === "update") {
          matches.forEach((row) => Object.assign(row, structuredClone(fields), { version: row.version + 1 }));
        }
        const count = matches.length;
        if (range) matches = matches.slice(range[0], range[1] + 1);
        return { data: head ? null : structuredClone(matches), count, error: null };
      };
      const builder = {
        select(_columns, options = {}) { head = options.head ?? false; return builder; },
        eq(key, expected) { conditions.push((row) => value(row, key) === expected); return builder; },
        neq(key, expected) { conditions.push((row) => value(row, key) !== expected); return builder; },
        is(key, expected) { conditions.push((row) => value(row, key) === expected); return builder; },
        or(expression) { const query = expression.match(/ilike\.%([^%]*)%/)?.[1] ?? ""; conditions.push((row) => `${row.title} ${row.description}`.includes(query)); return builder; },
        order() { return builder; },
        range(from, to) { range = [from, to]; return builder; },
        insert(input) { action = "insert"; fields = input; return builder; },
        update(input) { action = "update"; fields = input; return builder; },
        maybeSingle() { const result = execute(); return Promise.resolve({ ...result, data: result.data?.[0] ?? null }); },
        single() { return builder.maybeSingle(); },
        then(resolve, reject) { return Promise.resolve().then(execute).then(resolve, reject); },
      };
      return builder;
    },
  };
}

function setup(rows = []) {
  const actor = { id: "reporter", role: "member", team: "콘텐츠", supabase: createDatabase(rows) };
  const modules = {
    "next/server": { NextResponse: Response }, zod,
    "@/lib/development-requests": requests,
    "@/lib/server/auth": { authenticateRequest: async (request) => {
      if (!request.headers.has("authorization")) throw new ApiError(401, "AUTH_REQUIRED", "로그인이 필요합니다.");
      return actor;
    } },
    "@/lib/http": { ApiError, parseJson: (request) => request.json(), apiErrorResponse: (error) => Response.json({ error: { code: error.code ?? "ERROR", message: error.message } }, { status: error.status ?? 500 }) },
  };
  const commonJsModule = { exports: {} };
  runInNewContext(`(function(require, module, exports) { ${code}\n})`, { URL, Response, console })((key) => {
    if (!(key in modules)) throw new Error(`Unexpected module ${key}`);
    return modules[key];
  }, commonJsModule, commonJsModule.exports);
  return { routes: commonJsModule.exports, actor, rows };
}

function request(method, body, query = "", authenticated = true) {
  return new Request(`https://os.example/api/v1/development-requests${query}`, { method, headers: { ...(authenticated ? { authorization: "Bearer test-session" } : {}), "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

const record = (fields = {}) => ({ id: requestId, record_type: "ai_job", metadata: { kind: "development_request", category: "bug" }, title: "저장 오류", description: "저장이 안 됩니다", status: "backlog", created_by: "reporter", owner_id: "reporter", parent_id: projectId, version: 1, archived_at: null, ...fields });

test("request API authenticates before queries and rejects forged management input", async () => {
  const { routes, rows } = setup();
  assert.equal((await routes.POST(request("POST", { title: "요청" }, "", false))).status, 401);
  assert.equal((await routes.POST(request("POST", { title: "요청", status: "done" }))).status, 400);
  assert.equal(rows.length, 0);
});

test("request API creates linked backlog request with server-owned identity and rejects archived projects", async () => {
  const { routes, rows } = setup([{ id: projectId, record_type: "project", archived_at: null }]);
  const response = await routes.POST(request("POST", { title: "저장 오류", parentId: projectId, pageUrl: "/knowledge" }));
  assert.equal(response.status, 201);
  const { record: created } = await response.json();
  assert.equal(created.created_by, "reporter");
  assert.equal(created.owner_id, "reporter");
  assert.equal(created.status, "backlog");
  assert.equal(created.metadata.kind, "development_request");
  assert.equal(created.metadata.pageUrl, "/knowledge");
  rows[0].archived_at = "2026-09-05T13:00:00Z";
  assert.equal((await routes.POST(request("POST", { title: "다른 요청", parentId: projectId }))).status, 404);
  assert.equal(rows.length, 2);
});

test("request summary returns open rows, full status counts and only development requests", async () => {
  const { routes } = setup([
    record(), record({ id: "done", status: "done" }), record({ id: "other", created_by: "other", status: "active" }),
    record({ id: "ordinary-job", metadata: {} }), record({ id: "archived", archived_at: "2026-09-04" }),
  ]);
  const response = await routes.GET(request("GET", null, "?summary=1&scope=mine"));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(body.requests.length, 1);
  assert.equal(body.total, 1);
  assert.deepEqual(body.counts, { backlog: 1, active: 0, review: 0, done: 1, blocked: 0 });
  assert.equal(body.canManage, false);
});

test("deep-linked request ID and ownership scope are honored independently of the inbox", async () => {
  const { routes } = setup([record({ created_by: "other" })]);
  assert.equal((await (await routes.GET(request("GET", null, `?id=${requestId}`))).json()).requests.length, 1);
  assert.equal((await (await routes.GET(request("GET", null, `?id=${requestId}&scope=mine`))).json()).requests.length, 0);
  assert.equal((await routes.GET(request("GET", null, "?id=invalid"))).status, 400);
});

test("API enforces stale versions, reporter ownership and administrator completion results", async () => {
  const { routes, actor, rows } = setup([record()]);
  const edit = (fields) => request("PATCH", { id: requestId, expectedVersion: 1, ...fields });
  assert.equal((await routes.PATCH(edit({ expectedVersion: 99, title: "변경" }))).status, 409);
  actor.id = "other";
  assert.equal((await routes.PATCH(edit({ title: "변경" }))).status, 403);
  actor.role = "admin";
  assert.equal((await routes.PATCH(edit({ status: "done" }))).status, 400);
  const response = await routes.PATCH(edit({ status: "done", resolution: "안내 완료" }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).record.version, 2);
  assert.equal(rows[0].metadata.resolution, "안내 완료");
});
