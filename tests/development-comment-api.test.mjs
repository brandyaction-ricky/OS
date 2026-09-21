import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as zod from "zod";
import * as comments from "../lib/development-comments.ts";

const requestId = "80950395-23b2-4b5a-bd0f-c3d8b8b78d92";
const otherRequestId = "8abcb821-b9c9-49ff-96a2-b116030b6edf";
const authorId = "1eecc49f-13ea-4c53-96c6-6f36dcb6d034";
const source = await readFile(new URL("../app/api/v1/development-request-comments/route.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function createDatabase(rows, profiles) {
  let insertSequence = 0;
  return {
    from(table) {
      const records = table === "os_records" ? rows : profiles;
      const conditions = [], ordering = [];
      let action = "read", input, range;
      const value = (row, key) => key === "metadata->>kind" ? row.metadata?.kind : row[key];
      const execute = () => {
        let matches = records.filter((row) => conditions.every((condition) => condition(row)));
        if (action === "insert") {
          insertSequence += 1;
          const row = { ...structuredClone(input), id: `00000000-0000-4000-8000-${String(insertSequence).padStart(12, "0")}`, version: 1, archived_at: null, created_at: `2026-09-21T06:00:0${insertSequence}Z`, updated_at: `2026-09-21T06:00:0${insertSequence}Z` };
          records.push(row); matches = [row];
        }
        matches.sort((left, right) => {
          for (const [key, ascending] of ordering) {
            const compared = String(value(left, key) ?? "").localeCompare(String(value(right, key) ?? ""));
            if (compared) return ascending ? compared : -compared;
          }
          return 0;
        });
        if (range) matches = matches.slice(range[0], range[1] + 1);
        return { data: structuredClone(matches), error: null };
      };
      const builder = {
        select() { return builder; },
        eq(key, expected) { conditions.push((row) => value(row, key) === expected); return builder; },
        is(key, expected) { conditions.push((row) => value(row, key) === expected); return builder; },
        order(key, { ascending = true } = {}) { ordering.push([key, ascending]); return builder; },
        range(from, to) { range = [from, to]; return builder; },
        insert(fields) { action = "insert"; input = fields; return builder; },
        maybeSingle() { const result = execute(); return Promise.resolve({ ...result, data: result.data[0] ?? null }); },
        single() { return builder.maybeSingle(); },
        then(resolve, reject) { return Promise.resolve().then(execute).then(resolve, reject); },
      };
      return builder;
    },
  };
}

function setup(extraRows = []) {
  const rows = [
    { id: requestId, record_type: "ai_job", metadata: { kind: "development_request" }, parent_id: "project", brand: "BRANDYACTION", team: "개발", archived_at: null },
    { id: otherRequestId, record_type: "ai_job", metadata: { kind: "development_request" }, parent_id: "project", brand: "BRANDYACTION", team: "개발", archived_at: null },
    ...extraRows,
  ];
  const database = createDatabase(rows, [{ id: authorId, display_name: "브랜디", email: "brand@example.com" }]);
  const actor = { id: authorId, ownerId: authorId, name: "brand@example.com", role: "admin", team: "개발", supabase: database };
  const modules = {
    "next/server": { NextResponse: Response }, zod,
    "@/lib/development-comments": comments,
    "@/lib/server/auth": { authenticateRequest: async (request) => {
      if (!request.headers.has("authorization")) throw new ApiError(401, "AUTH_REQUIRED", "로그인이 필요합니다.");
      return actor;
    } },
    "@/lib/supabase/server": { createServiceSupabase: () => database },
    "@/lib/http": { ApiError, parseJson: (request) => request.json(), apiErrorResponse: (error) => Response.json({ error: { code: error.code ?? "ERROR", message: error.message } }, { status: error.status ?? 500 }) },
  };
  const commonJsModule = { exports: {} };
  runInNewContext(`(function(require, module, exports) { ${code}\n})`, { URL, Response, console })((key) => {
    if (!(key in modules)) throw new Error(`Unexpected module ${key}`);
    return modules[key];
  }, commonJsModule, commonJsModule.exports);
  return { routes: commonJsModule.exports, rows };
}

function request(method, body, query = "", authenticated = true) {
  return new Request(`https://os.example/api/v1/development-request-comments${query}`, { method, headers: { ...(authenticated ? { authorization: "Bearer test-session" } : {}), "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

test("comment API authenticates and verifies an accessible development request", async () => {
  const { routes } = setup();
  assert.equal((await routes.GET(request("GET", null, `?requestId=${requestId}`, false))).status, 401);
  assert.equal((await routes.GET(request("GET", null, "?requestId=invalid"))).status, 400);
  assert.equal((await routes.GET(request("GET", null, "?requestId=7fd794f1-bf6d-4b8b-884d-159e0f21e726"))).status, 404);
});

test("comment API creates separate append-only records with server-owned authorship", async () => {
  const { routes, rows } = setup();
  const first = await routes.POST(request("POST", { requestId, body: "  첫 번째 확인  " }));
  const second = await routes.POST(request("POST", { requestId, body: "두 번째 확인" }));
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const created = rows.filter((row) => row.record_type === "development_comment");
  assert.equal(created.length, 2);
  assert.notEqual(created[0].id, created[1].id);
  assert.equal(created[0].description, "첫 번째 확인");
  assert.equal(created[0].created_by, authorId);
  assert.equal(created[0].owner_id, authorId);
  assert.equal(created[0].metadata.authorName, "브랜디");
  assert.equal(created[0].metadata.requestId, requestId);
});

test("replies must point to a comment on the same request", async () => {
  const sameCommentId = "2d385dd5-8d54-4a28-bb96-3d837a0cdf71";
  const otherCommentId = "1673195e-64a4-490b-ab7e-b1cffc286f13";
  const { routes, rows } = setup([
    { id: sameCommentId, record_type: "development_comment", parent_id: requestId, metadata: { kind: "development_comment", requestId, replyTo: "" }, archived_at: null, created_at: "2026-09-21T05:00:00Z" },
    { id: otherCommentId, record_type: "development_comment", parent_id: otherRequestId, metadata: { kind: "development_comment", requestId: otherRequestId, replyTo: "" }, archived_at: null, created_at: "2026-09-21T05:00:01Z" },
  ]);
  assert.equal((await routes.POST(request("POST", { requestId, body: "같은 요청의 답글", replyTo: sameCommentId }))).status, 201);
  assert.equal(rows.at(-1).metadata.replyTo, sameCommentId);
  const replyId = rows.at(-1).id;
  assert.equal((await routes.POST(request("POST", { requestId, body: "답글의 답글", replyTo: replyId }))).status, 400);
  assert.equal((await routes.POST(request("POST", { requestId, body: "다른 요청의 답글", replyTo: otherCommentId }))).status, 404);
});

test("comment list is chronological and private no-store", async () => {
  const { routes } = setup([
    { id: "00000000-0000-4000-8000-000000000102", record_type: "development_comment", parent_id: requestId, metadata: { kind: "development_comment", requestId, replyTo: "" }, archived_at: null, created_at: "2026-09-21T05:00:02Z" },
    { id: "00000000-0000-4000-8000-000000000101", record_type: "development_comment", parent_id: requestId, metadata: { kind: "development_comment", requestId, replyTo: "" }, archived_at: null, created_at: "2026-09-21T05:00:01Z" },
  ]);
  const response = await routes.GET(request("GET", null, `?requestId=${requestId}`));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(body.comments.map((comment) => comment.id), ["00000000-0000-4000-8000-000000000101", "00000000-0000-4000-8000-000000000102"]);
});
