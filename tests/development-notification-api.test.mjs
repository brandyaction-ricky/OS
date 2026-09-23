import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as zod from "zod";
import * as notifications from "../lib/development-notifications.ts";

const requestId = "80950395-23b2-4b5a-bd0f-c3d8b8b78d92";
const actorId = "1eecc49f-13ea-4c53-96c6-6f36dcb6d034";
const otherId = "74c2ada6-6a89-4560-8484-1df8c14b9690";
const notificationId = "da46a1f8-987b-4c48-82bc-f38a726c3f22";
const otherNotificationId = "c41e49b7-1490-412e-b316-42fda069831c";
const source = await readFile(new URL("../app/api/v1/development-notifications/route.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function createDatabase(rows) {
  return {
    from(table) {
      assert.equal(table, "os_records");
      const conditions = [], ordering = [];
      let action = "read", input, range;
      const value = (row, key) => key === "metadata->>kind" ? row.metadata?.kind : row[key];
      const execute = () => {
        let matches = rows.filter((row) => conditions.every((condition) => condition(row)));
        matches.sort((left, right) => {
          for (const [key, ascending] of ordering) {
            const compared = String(value(left, key) ?? "").localeCompare(String(value(right, key) ?? ""));
            if (compared) return ascending ? compared : -compared;
          }
          return 0;
        });
        if (range) matches = matches.slice(range[0], range[1] + 1);
        if (action === "update") matches.forEach((row) => Object.assign(row, structuredClone(input), { version: row.version + 1, updated_at: "2026-09-21T12:00:00Z" }));
        return { data: structuredClone(matches), error: null };
      };
      const builder = {
        select() { return builder; },
        eq(key, expected) { conditions.push((row) => value(row, key) === expected); return builder; },
        is(key, expected) { conditions.push((row) => value(row, key) === expected); return builder; },
        in(key, expected) { conditions.push((row) => expected.includes(value(row, key))); return builder; },
        order(key, { ascending = true } = {}) { ordering.push([key, ascending]); return builder; },
        range(from, to) { range = [from, to]; return builder; },
        update(fields) { action = "update"; input = fields; return builder; },
        maybeSingle() { const result = execute(); return Promise.resolve({ ...result, data: result.data[0] ?? null }); },
        then(resolve, reject) { return Promise.resolve().then(execute).then(resolve, reject); },
      };
      return builder;
    },
  };
}

function setup() {
  const rows = [
    { id: requestId, record_type: "ai_job", title: "알림 검증 요청", metadata: { kind: "development_request" }, archived_at: null },
    { id: notificationId, record_type: "development_notification", title: "개발 요청 멘션", description: "", status: "unread", parent_id: requestId, owner_id: actorId, version: 1, archived_at: null, created_at: "2026-09-21T11:00:00Z", metadata: { kind: "development_notification", reason: "mention", actorName: "리키", deliveredAt: "", readAt: "" } },
    { id: otherNotificationId, record_type: "development_notification", title: "개발 요청 담당 지정", description: "", status: "unread", parent_id: requestId, owner_id: otherId, version: 1, archived_at: null, created_at: "2026-09-21T11:01:00Z", metadata: { kind: "development_notification", reason: "assignment", actorName: "안저", deliveredAt: "", readAt: "" } },
  ];
  const database = createDatabase(rows);
  const modules = {
    "next/server": { NextResponse: Response }, zod,
    "@/lib/development-notifications": notifications,
    "@/lib/server/auth": { authenticateRequest: async (request) => {
      if (!request.headers.has("authorization")) throw new ApiError(401, "AUTH_REQUIRED", "로그인이 필요합니다.");
      return { id: actorId, ownerId: actorId, supabase: database };
    } },
    "@/lib/supabase/server": { createServiceSupabase: () => database },
    "@/lib/http": { ApiError, parseJson: (request) => request.json(), apiErrorResponse: (error) => Response.json({ error: { code: error.code ?? "ERROR", message: error.message } }, { status: error.status ?? 500 }) },
  };
  const commonJsModule = { exports: {} };
  runInNewContext(`(function(require, module, exports) { ${code}\n})`, { URL, Response, console, Date })((key) => {
    if (!(key in modules)) throw new Error(`Unexpected module ${key}`);
    return modules[key];
  }, commonJsModule, commonJsModule.exports);
  return { routes: commonJsModule.exports, rows };
}

function request(method, body, authenticated = true) {
  return new Request("https://os.example/api/v1/development-notifications", { method, headers: { ...(authenticated ? { authorization: "Bearer test-session" } : {}), "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

test("notification API authenticates and returns only the recipient inbox without private content", async () => {
  const { routes, rows } = setup();
  assert.equal((await routes.GET(request("GET", null, false))).status, 401);
  const response = await routes.GET(request("GET"));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(body.unread, 1);
  assert.equal(body.notifications.length, 1);
  assert.equal(body.notifications[0].id, notificationId);
  assert.equal(body.notifications[0].requestTitle, "알림 검증 요청");
  assert.equal(Object.hasOwn(body.notifications[0], "description"), false);
  assert.ok(body.notifications[0].deliveredAt);
  assert.ok(rows.find((row) => row.id === notificationId).metadata.deliveredAt);
});

test("notification API marks only the recipient notification as read", async () => {
  const { routes, rows } = setup();
  const response = await routes.PATCH(request("PATCH", { ids: [notificationId] }));
  assert.equal(response.status, 200);
  assert.equal(rows.find((row) => row.id === notificationId).status, "read");
  assert.ok(rows.find((row) => row.id === notificationId).metadata.readAt);
  assert.equal((await routes.PATCH(request("PATCH", { ids: [otherNotificationId] }))).status, 404);
});
