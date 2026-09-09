import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as intents from "../lib/telegram-intents.ts";

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const actor = { id: "admin", role: "admin", user: { id: "admin" } };

async function setup(file, handler, options = {}) {
  const calls = [], sent = [], inserts = [];
  const db = { from(table) {
    const query = { table, operations: [] };
    const chain = { then(resolve, reject) { calls.push(query); return Promise.resolve(handler(query)).then(resolve, reject); } };
    for (const method of ["select", "insert", "update", "upsert", "eq", "neq", "is", "in", "order", "limit", "single", "maybeSingle"]) chain[method] = (...args) => { query.operations.push({ method, args }); if (method === "insert") inserts.push({ table, payload: args[0] }); return chain; };
    return chain;
  } };
  const source = await readFile(new URL(`../app/api/v1/telegram/${file}/route.ts`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const http = { ApiError, apiErrorResponse: (error) => Response.json({ error: { code: error.code, message: error.message } }, { status: error.status ?? 500 }) };
  const modules = {
    "next/server": { NextResponse: { json: (value, init) => Response.json(value, init) } },
    "@/lib/http": http,
    "@/lib/config": { OPENAI_ANSWER_MODEL: "test-model" },
    "@/lib/server/auth": { authenticateRequest: async () => options.actor ?? actor, safeSecretMatch: (a, b) => a === b },
    "@/lib/supabase/server": { createServiceSupabase: () => db },
    "@/lib/telegram-intents": intents,
    "@/lib/server/answer": { answerFromKnowledge: async () => "근거 답변" },
    "@/lib/server/search": { searchDocuments: async () => ({ results: [] }) },
  };
  const exports = {};
  runInNewContext(code, { exports, require: (id) => { if (!(id in modules)) throw Error(id); return modules[id]; }, process: { env: { TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_WEBHOOK_SECRET: "test-secret", TELEGRAM_BOT_USERNAME: "our_bot", TELEGRAM_CAPTURE_OWNER_EMAIL: "owner@example.com", ...options.env } }, Buffer, AbortSignal, URL, Date, console,
    fetch: async (url, init) => {
      const method = url.split("/").at(-1);
      if (method === "sendMessage") { sent.push(JSON.parse(init.body)); return Response.json({ ok: true, result: {} }); }
      if (options.offline) throw new Error("network unavailable");
      if (method === "getMe") return Response.json({ ok: true, result: { username: "our_bot", first_name: "Bot" } });
      if (method === "getWebhookInfo") return Response.json({ ok: true, result: { url: "https://example.com/webhook", pending_update_count: 0, last_synchronization_error_date: 42 } });
      throw new Error(`Unexpected external call ${method}`);
    },
  });
  return { api: exports, calls, sent, inserts };
}

const where = (query, key) => query.operations.find((op) => op.method === "eq" && op.args[0] === key)?.args[1];
const incoming = (extra = {}, secret = "test-secret") => new Request("https://example.com/api/v1/telegram/webhook", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret }, body: JSON.stringify({ update_id: 10, message: { message_id: 20, chat: { id: 30, type: "private" }, from: { id: 40, first_name: "직원" }, text: "질문", ...extra } }) });
const normalHandler = (query) => {
  if (query.table === "os_telegram_users") return { data: { status: "approved" }, error: null };
  if (query.table === "os_profiles") return { data: { id: "capture-owner" }, error: null };
  if (query.table === "os_documents") return query.operations.some((op) => op.method === "insert") ? { data: { id: "saved-doc" }, error: null } : { data: null, error: null };
  return { data: [], error: null };
};

test("capture without an environment or OS-configured owner stops before profile lookup or document writes", async () => {
  const ctx = await setup("webhook", (query) => query.table === "os_records" ? { data: null, error: null } : normalHandler(query), { env: { TELEGRAM_CAPTURE_OWNER_EMAIL: "" } });
  const response = await ctx.api.POST(incoming({ text: "#raw idea" }));
  assert.equal((await response.json()).handledError, true);
  assert.equal(ctx.calls.some((call) => call.table === "os_profiles"), false);
  assert.equal(ctx.inserts.some((call) => call.table === "os_documents"), false);
  assert.match(ctx.sent[0].text, /저장 담당자가 연결되지 않아 저장하지 않았습니다/);
});

test("capture owner can be resolved from the active OS company setting", async () => {
  const ctx = await setup("webhook", (query) => {
    if (query.table === "os_records") return { data: { assignee_id: "capture-owner" }, error: null };
    return normalHandler(query);
  }, { env: { TELEGRAM_CAPTURE_OWNER_EMAIL: "" } });
  const body = await (await ctx.api.POST(incoming({ text: "/후기 OS 담당자 설정 검수" }))).json();
  assert.equal(body.captured, true);
  const settingLookup = ctx.calls.find((call) => call.table === "os_records");
  assert.equal(where(settingLookup, "record_type"), "company_setting");
  assert.equal(where(settingLookup, "title"), "Telegram 캡처 담당자");
  const profileLookup = ctx.calls.find((call) => call.table === "os_profiles");
  assert.equal(where(profileLookup, "id"), "capture-owner");
});

test("Telegram diagnostics show approved users, exact totals and observed last receipt", async () => {
  const ctx = await setup("setup", (q) => q.table === "os_channel_turns" ? { data: [{ external_user_id: "employee", created_at: "2026-09-08T00:00:00Z" }], error: null } : where(q, "status") === "approved" ? { data: [{ external_user_id: "employee", display_name: "직원", status: "approved" }], count: 2, error: null } : { data: [], count: 0, error: null });
  const body = await (await ctx.api.GET(new Request("https://example.com"))).json();
  assert.equal(body.approvedCount, 2); assert.equal(body.pendingCount, 0);
  assert.equal(body.approvedUsers[0].last_received_at, "2026-09-08T00:00:00Z");
  assert.equal(body.webhook.lastSynchronizationErrorAt, 42);
  assert.doesNotMatch(JSON.stringify(body), /test-token|test-secret/);
});

test("DB failure is not an empty approval list; provider failure keeps stored diagnostics visible", async () => {
  const brokenDb = await setup("setup", () => ({ data: null, error: { message: "DB down" } }));
  assert.equal((await brokenDb.api.GET(new Request("https://example.com"))).status, 500);
  const offline = await setup("setup", () => ({ data: [], error: null, count: 0 }), { offline: true });
  const body = await (await offline.api.GET(new Request("https://example.com"))).json();
  assert.equal(body.webhook, null); assert.ok(body.diagnosticError); assert.equal(body.pendingCount, 0);
});

test("non-admin approval attempts and invalid webhook secrets have no database or outbound side effects", async () => {
  const denied = await setup("setup", normalHandler, { actor: { ...actor, role: "member" } });
  assert.equal((await denied.api.PATCH(incoming())).status, 403); assert.equal(denied.calls.length, 0);
  const webhook = await setup("webhook", normalHandler);
  assert.equal((await webhook.api.POST(incoming({}, "wrong"))).status, 401);
  assert.equal(webhook.calls.length, 0); assert.equal(webhook.sent.length, 0);
});

test("failed first registration sends an honest failure, never a pending success receipt", async () => {
  const ctx = await setup("webhook", (q) => q.table === "os_telegram_users" && q.operations.some((op) => op.method === "upsert") ? { error: { message: "write failed" } } : { data: null, error: null });
  const body = await (await ctx.api.POST(incoming())).json();
  assert.equal(body.handledError, true);
  assert.match(ctx.sent[0].text, /저장되지 않았습니다/);
  assert.doesNotMatch(ctx.sent[0].text, /등록 요청을 확인했습니다/);
});

test("photo without a chosen destination asks first and does not fetch, OCR or store the photo", async () => {
  const ctx = await setup("webhook", normalHandler);
  const body = await (await ctx.api.POST(incoming({ text: undefined, photo: [{ file_id: "photo" }] }))).json();
  assert.equal(body.needsDestination, true);
  assert.match(ctx.sent[0].text, /아직 저장하지 않았습니다/);
  assert.equal(ctx.inserts.filter((item) => item.table === "os_documents").length, 0);
});

test("a Korean review command creates a draft, a receipt and a direct document link", async () => {
  const ctx = await setup("webhook", normalHandler);
  const body = await (await ctx.api.POST(incoming({ text: "/후기 좋은 강의였습니다" }))).json();
  assert.equal(body.captured, true);
  const document = ctx.inserts.find((insert) => insert.table === "os_documents").payload;
  assert.equal(document.status, "draft"); assert.equal(document.folder, "02_Wiki/상품후기");
  assert.ok(ctx.inserts.some((insert) => insert.table === "os_channel_turns"));
  assert.match(ctx.sent[0].text, /knowledge\?document=saved-doc/);
});

test("retrying a saved capture reuses the prior document without an extra insert", async () => {
  const ctx = await setup("webhook", (q) => q.table === "os_documents" ? { data: { id: "saved-doc" }, error: null } : normalHandler(q));
  const body = await (await ctx.api.POST(incoming({ text: "/후기 다시 전달" }))).json();
  assert.equal(body.documentId, "saved-doc");
  assert.equal(ctx.inserts.filter((insert) => insert.table === "os_documents").length, 0);
});

test("voice is acknowledged as unavailable instead of silently disappearing", async () => {
  const ctx = await setup("webhook", normalHandler);
  const body = await (await ctx.api.POST(incoming({ text: undefined, voice: { file_id: "voice" } }))).json();
  assert.equal(body.unsupported, "voice"); assert.match(ctx.sent[0].text, /저장된 내용은 없습니다/);
  assert.equal(ctx.inserts.filter((item) => item.table === "os_documents").length, 0);
});

test("start returns usage guidance instead of searching arbitrary knowledge", async () => {
  const ctx = await setup("webhook", normalHandler);
  const body = await (await ctx.api.POST(incoming({ text: "/start" }))).json();
  assert.equal(body.started, true);
  assert.match(ctx.sent[0].text, /회사 지식 질문/);
});
