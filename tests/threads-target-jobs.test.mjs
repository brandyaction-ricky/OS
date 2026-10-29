import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as zod from "zod";

class ApiError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code }); }
}
async function load(file, modules) {
  const source = await readFile(new URL("../" + file, import.meta.url), "utf8");
  const compiled = { exports: {} };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: compiled, exports: compiled.exports, URL, Date, require: name => { assert.ok(name in modules, name); return modules[name]; } });
  return compiled.exports;
}
const editorial = await load("lib/threads-editorial.ts", { zod, "./http": { ApiError } });
const schedule = await load("lib/content-automation-schedule.ts", {});
const references = await load("lib/threads-reference.ts", { zod, "./http": { ApiError }, "./threads-editorial": editorial, "./content-automation-schedule": schedule });
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const targetId = "33333333-3333-4333-8333-333333333333", otherTarget = "44444444-4444-4444-8444-444444444444";
const job = (id, changes = {}) => ({ id, record_type: "ai_job", owner_id: owner, archived_at: null,
  status: "done", stage: "completed", updated_at: "2026-10-20T00:00:00Z",
  metadata: { space: "personal", proc: "threads", targetId, result: { posts: ["Saved draft"] } }, ...changes });

async function harness({ jobs = [], targetOwner = owner, channel = "threads", queryError = null } = {}) {
  const calls = [];
  const db = { from(table) {
    calls.push(table);
    let rows = [...jobs];
    const ordering = [];
    const value = (row, key) => key.startsWith("metadata->>") ? row.metadata[key.slice(11)] : row[key];
    return {
      select() { return this; },
      eq(key, expected) { rows = rows.filter(row => value(row, key) === expected); return this; },
      is(key, expected) { rows = rows.filter(row => value(row, key) === expected); return this; },
      order(key, { ascending }) { ordering.push({ key, ascending }); return this; },
      async limit(limit) {
        rows.sort((a, b) => {
          for (const { key, ascending } of ordering) {
            const comparison = String(a[key]).localeCompare(String(b[key]));
            if (comparison) return ascending ? comparison : -comparison;
          }
          return 0;
        });
        return { data: queryError ? null : rows.slice(0, limit), error: queryError };
      },
    };
  } };
  const api = await load("app/api/v1/content/automation/[resource]/route.ts", {
    "next/server": { NextResponse: Response }, zod,
    "@/lib/http": { ApiError, apiErrorResponse: error => Response.json({ error: { code: error.code } }, { status: error.status ?? 500 }) },
    "@/lib/server/auth": { authenticateRequest: async () => ({ ownerId: owner }) },
    "@/lib/supabase/server": { createServiceSupabase: () => db },
    "@/lib/server/content-automation-validators": {}, "@/lib/content-automation-schedule": {}, "@/lib/content-automation-csv": {},
    "@/lib/threads-reference": references, "@/lib/threads-editorial": editorial, "@/lib/server/threads-reference": {},
    "@/lib/server/content-automation-v07": {
      AUTOMATION_CHANNELS: ["threads", "card", "shorts"], AUTOMATION_PROCS: ["threads"],
      assertHumanOwner: actor => actor.ownerId,
      getPersonalRecord: async (actor, id, type) => {
        if (actor.ownerId !== targetOwner || id !== targetId || type !== "content_publish") throw new ApiError(404, "AUTOMATION_NOT_FOUND", "Not found");
        return { id, owner_id: targetOwner, metadata: { channel } };
      },
      listPersonalRecords: () => { throw new Error("Must filter by target before taking the global list limit"); },
      listTeamItems: () => { throw new Error("Target-specific private jobs must not use the team list"); },
    },
  });
  return { calls, get: (query = `targetId=${targetId}`) => api.GET(new Request(`https://os.test/api/v1/content/automation/jobs?${query}`), { params: Promise.resolve({ resource: "jobs" }) }) };
}

test("a draft's jobs remain available beyond 100 newer unrelated jobs without leaking other owners or processes", async () => {
  const unrelated = Array.from({ length: 150 }, (_, index) => job(`unrelated-${index}`, {
    updated_at: "2026-10-29T00:00:00Z", metadata: { ...job("").metadata, targetId: otherTarget },
  }));
  const wanted = [job("older"), job("pending", { status: "backlog", stage: "queued", updated_at: "2026-10-21T00:00:00Z" })];
  const excluded = [job("foreign", { owner_id: other }), job("archived", { archived_at: "2026-10-22T00:00:00Z" }),
    job("wrong-process", { metadata: { ...job("").metadata, proc: "review" } }),
    job("wrong-space", { metadata: { ...job("").metadata, space: "team" } }), job("wrong-type", { record_type: "task" })];
  const { get } = await harness({ jobs: [...unrelated, ...excluded, ...wanted] });
  const response = await get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const { jobs } = await response.json();
  assert.deepEqual(jobs.map(row => row.id), ["pending", "older"]);
  assert.ok(jobs.every(row => row.queueInfo === null));
  assert.deepEqual(jobs[1].metadata.result.posts, ["Saved draft"]);
  assert.deepEqual((await (await get(`targetId=${targetId}&status=completed`)).json()).jobs.map(row => row.id), ["older"]);
});

test("targeted requests reject malformed ids, team scope and inaccessible or non-Threads drafts before querying jobs", async () => {
  const ordinary = await harness();
  for (const query of ["targetId=", "targetId=not-a-uuid", `targetId=${targetId}&scope=team`]) assert.equal((await ordinary.get(query)).status, 400);
  assert.equal(ordinary.calls.length, 0);
  for (const changes of [{ targetOwner: other }, { channel: "card" }]) {
    const attempt = await harness(changes);
    assert.equal((await attempt.get()).status, changes.targetOwner ? 404 : 422);
    assert.equal(attempt.calls.length, 0);
  }
});

test("job read failure stays retryable instead of appearing to be a fresh empty draft", async () => {
  const { get } = await harness({ queryError: { code: "unavailable" } });
  const response = await get();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "AUTOMATION_LIST_FAILED");
});
