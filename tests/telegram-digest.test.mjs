import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as team from "../lib/telegram-team.ts";

class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }

async function setup() {
  const calls = []; const sends = []; let fingerprint = "";
  const db = { from(table) {
    const query = { table, operations: [] };
    const chain = { then(resolve, reject) {
      calls.push(query);
      const update = query.operations.find((op) => op.method === "update")?.args[0];
      if (table === "os_telegram_chats" && update) { fingerprint = update.last_digest_fingerprint; return Promise.resolve({ data: null, error: null }).then(resolve, reject); }
      if (table === "os_telegram_chats") return Promise.resolve({ data: [{ external_chat_id: "-100", digest_hour_kst: 9, last_digest_fingerprint: fingerprint }], error: null }).then(resolve, reject);
      if (table === "os_records") return Promise.resolve({ data: [{ id: "task-1", title: "검토 업무", record_type: "task", status: "review", assignee_id: null, due_date: "2020-01-01", updated_at: "2026-09-22T00:00:00Z" }], error: null }).then(resolve, reject);
      if (table === "os_documents") return Promise.resolve({ data: [{ id: "doc-1", title: "현재기준", status: "canonical", current_version: 3, updated_at: "2026-09-22T00:00:00Z" }], error: null }).then(resolve, reject);
      return Promise.resolve({ data: [], error: null }).then(resolve, reject);
    } };
    for (const method of ["select", "update", "eq", "in", "is", "gte", "order", "limit"]) chain[method] = (...args) => { query.operations.push({ method, args }); return chain; };
    return chain;
  } };
  const source = await readFile(new URL("../app/api/v1/telegram/digest/route.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const modules = {
    "node:crypto": { createHash },
    "next/server": { NextResponse: { json: (value, init) => Response.json(value, init) } },
    "@/lib/http": { ApiError, apiErrorResponse: (error) => Response.json({ error: { code: error.code, message: error.message } }, { status: error.status ?? 500 }) },
    "@/lib/server/auth": { safeSecretMatch: (a, b) => a === b },
    "@/lib/supabase/server": { createServiceSupabase: () => db },
    "@/lib/telegram-team": team,
  };
  runInNewContext(code, { exports, require: (id) => modules[id], process: { env: { CRON_SECRET: "cron-secret", TELEGRAM_BOT_TOKEN: "bot-token" } }, Date, Intl, AbortSignal, fetch: async (_url, init) => { sends.push(JSON.parse(init.body)); return Response.json({ ok: true, result: {} }); } });
  return { api: exports, calls, sends, getFingerprint: () => fingerprint };
}

const request = (secret = "cron-secret") => new Request("https://example.com/api/v1/telegram/digest", { headers: { authorization: `Bearer ${secret}` } });

test("Telegram digest rejects unauthenticated cron requests before database access", async () => {
  const ctx = await setup(); const response = await ctx.api.GET(request("wrong"));
  assert.equal(response.status, 401); assert.equal(ctx.calls.length, 0); assert.equal(ctx.sends.length, 0);
});

test("Telegram digest sends once and stays quiet while the fingerprint is unchanged", async () => {
  const ctx = await setup();
  const first = await (await ctx.api.GET(request())).json();
  const second = await (await ctx.api.GET(request())).json();
  assert.equal(first.sent, 1); assert.equal(second.sent, 0); assert.equal(second.unchanged, 1);
  assert.equal(ctx.sends.length, 1); assert.match(ctx.sends[0].text, /기한 도래·초과/); assert.ok(ctx.getFingerprint());
});
