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
  const calls = [], sent = [], inserts = [], answeredWith = [], searchCalls = [], telegramCalls = [];
  const db = { from(table) {
    const query = { table, operations: [] };
    const chain = { then(resolve, reject) { calls.push(query); return Promise.resolve(handler(query)).then(resolve, reject); } };
    for (const method of ["select", "insert", "update", "upsert", "eq", "neq", "is", "in", "gte", "lte", "ilike", "order", "limit", "single", "maybeSingle"]) chain[method] = (...args) => { query.operations.push({ method, args }); if (method === "insert") inserts.push({ table, payload: args[0] }); return chain; };
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
    "@/lib/search-relevance": await import("../lib/search-relevance.ts"),
    "@/lib/telegram-team": await import("../lib/telegram-team.ts"),
    "@/lib/telegram-meeting": await import("../lib/telegram-meeting.ts"),
    "@/lib/meeting-business": await import("../lib/meeting-business.ts"),
    "@/lib/meeting-documents": await import("../lib/meeting-documents.ts"),
    "@/lib/server/meeting-prep": { prepareMeetingBrief: options.prepareMeetingBrief ?? (async () => ({ latestMeeting: null, pending: [], todos: [], kpis: [] })) },
    "@/lib/server/meeting-summary": { summarizeMeetingText: options.summarizeMeetingText ?? (async () => ({ summary: "", decisions: [], pending: [], todos: [], mode: "local" })) },
    "@/lib/server/operating-baseline": { synthesizeOperatingBaseline: options.synthesizeOperatingBaseline ?? (async () => null) },
    "@/lib/server/answer": { answerFromKnowledge: async (_question, results) => { answeredWith.push(results); return "근거 답변"; } },
    "@/lib/server/search": { searchDocuments: async (_actor, input) => { searchCalls.push(input); return { results: typeof options.searchResults === "function" ? options.searchResults(input) : options.searchResults ?? [] }; } },
  };
  const exports = {};
  runInNewContext(code, { exports, require: (id) => { if (!(id in modules)) throw Error(id); return modules[id]; }, process: { env: { TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_WEBHOOK_SECRET: "test-secret", TELEGRAM_BOT_USERNAME: "our_bot", TELEGRAM_CAPTURE_OWNER_EMAIL: "owner@example.com", ...options.env } }, Buffer, AbortSignal, URL, Date, console,
    fetch: async (url, init) => {
      const method = url.split("/").at(-1);
      const telegramBody = init?.body ? JSON.parse(init.body) : {};
      telegramCalls.push({ method, body: telegramBody });
      if (method === "sendMessage") { sent.push(telegramBody); return Response.json({ ok: true, result: { message_id: 99 } }); }
      if (["answerCallbackQuery", "editMessageText", "editMessageReplyMarkup"].includes(method)) return Response.json({ ok: true, result: {} });
      if (options.offline) throw new Error("network unavailable");
      if (method === "getMe") return Response.json({ ok: true, result: { username: "our_bot", first_name: "Bot" } });
      if (method === "getWebhookInfo") return Response.json({ ok: true, result: { url: "https://example.com/webhook", pending_update_count: 0, last_synchronization_error_date: 42 } });
      throw new Error(`Unexpected external call ${method}`);
    },
  });
  return { api: exports, calls, sent, inserts, answeredWith, searchCalls, telegramCalls };
}

const where = (query, key) => query.operations.find((op) => op.method === "eq" && op.args[0] === key)?.args[1];
const incoming = (extra = {}, secret = "test-secret") => new Request("https://example.com/api/v1/telegram/webhook", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret }, body: JSON.stringify({ update_id: 10, message: { message_id: 20, chat: { id: 30, type: "private" }, from: { id: 40, first_name: "직원" }, text: "질문", ...extra } }) });
const callbackIncoming = (data) => new Request("https://example.com/api/v1/telegram/webhook", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "test-secret" }, body: JSON.stringify({ update_id: 11, callback_query: { id: "callback-1", from: { id: 40, first_name: "직원" }, data, message: { message_id: 99, chat: { id: 30, type: "private" }, text: "버튼" } } }) });
const normalHandler = (query) => {
  if (query.table === "os_telegram_users") return { data: { status: "approved", profile_id: "member-profile" }, error: null };
  if (query.table === "os_profiles") return { data: { id: "capture-owner" }, error: null };
  if (query.table === "os_documents") return query.operations.some((op) => op.method === "insert") ? { data: { id: "saved-doc" }, error: null } : { data: null, error: null };
  if (query.table === "os_channel_turns" && query.operations.some((op) => op.method === "insert")) return { data: { id: 71 }, error: null };
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

test("회의준비 answers with the prep brief (including last meeting summary) instead of a knowledge search", async () => {
  const ctx = await setup("webhook", normalHandler, {
    prepareMeetingBrief: async (_db, { brand }) => {
      assert.equal(brand, "마이인");
      return { latestMeeting: { id: "m1", title: "9/1 회의", date: "2026-09-01", pending: [], summary: "광고 예산 20만원 유지 결정" }, pending: ["네이버 유입 원인 미확정"], todos: [{ title: "진단 문항 확정", due_date: "2026-09-30" }], kpis: [{ id: "k1", title: "매출", current: 100, previous: 90, unit: "만원", signal: "양호" }] };
    },
  });
  const body = await (await ctx.api.POST(incoming({ text: "/회의준비 마이인" }))).json();
  assert.equal(body.meetingPrep, true);
  assert.match(ctx.sent[0].text, /광고 예산 20만원 유지 결정/);
  assert.match(ctx.sent[0].text, /네이버 유입 원인 미확정/);
  assert.match(ctx.sent[0].text, /진단 문항 확정 · 2026-09-30/);
  assert.equal(ctx.searchCalls.length, 0);
});

test("회의준비 without a business loops over 마이인 and 브랜디에듀 with separate summaries", async () => {
  const ctx = await setup("webhook", normalHandler, {
    prepareMeetingBrief: async (_db, { brand }) => ({
      latestMeeting: { id: `m-${brand}`, title: `${brand} 회의`, date: "2026-09-01", pending: [], summary: `${brand} 지난 회의 요약` },
      pending: [], todos: [], kpis: [],
    }),
  });
  const body = await (await ctx.api.POST(incoming({ text: "/회의준비" }))).json();
  assert.equal(body.meetingPrep, true);
  assert.match(ctx.sent[0].text, /마이인 지난 회의 요약/);
  assert.match(ctx.sent[0].text, /브랜디액션 에듀 지난 회의 요약/);
  assert.match(ctx.sent[0].text, /회의 준비 · 마이인\(진단\)/);
  assert.match(ctx.sent[0].text, /회의 준비 · 자영업 교육/);
});

test("회의기록 without a recognized business sends usage guidance and saves nothing", async () => {
  const ctx = await setup("webhook", normalHandler);
  const body = await (await ctx.api.POST(incoming({ text: "/회의기록 모르는사업 아무 내용" }))).json();
  assert.equal(body.meetingUsage, true);
  assert.match(ctx.sent[0].text, /사업은 마이인, 브랜디에듀\(교육\), 회사\(전체\)만 인식/);
  assert.equal(ctx.inserts.filter((insert) => insert.table === "os_records").length, 0);
});

test("회의기록 requires an OS-linked profile before it will create records", async () => {
  const ctx = await setup("webhook", (q) => q.table === "os_telegram_users" ? { data: { status: "approved", profile_id: null }, error: null } : normalHandler(q));
  const body = await (await ctx.api.POST(incoming({ text: "/회의기록 마이인 광고 예산은 20만원으로 유지하기로 했다." }))).json();
  assert.equal(body.handledError, true);
  assert.match(ctx.sent[0].text, /OS 구성원 계정 연결 후/);
  assert.equal(ctx.inserts.filter((insert) => insert.table === "os_records").length, 0);
});

test("회의기록 extracts, links decisions/tasks to the meeting and pushes raw+summary knowledge documents to the existing folders", async () => {
  const ctx = await setup("webhook", (query) => {
    if (query.table === "os_documents") {
      const insertOp = query.operations.find((op) => op.method === "insert");
      return { data: { id: insertOp.args[0].source === "meeting_raw" ? "raw-doc-1" : "summary-doc-1" }, error: null };
    }
    if (query.table !== "os_records") return normalHandler(query);
    const insertOp = query.operations.find((op) => op.method === "insert");
    if (!insertOp) return { data: null, error: null }; // duplicate-check select finds nothing
    return { data: { id: `${insertOp.args[0].record_type}-1` }, error: null };
  }, {
    summarizeMeetingText: async (transcript, meetingDate) => {
      assert.match(transcript, /광고 예산/);
      assert.match(meetingDate, /^\d{4}-\d{2}-\d{2}$/);
      return { summary: "- 광고 예산 유지 결정", decisions: ["광고 예산 20만원 유지"], pending: ["네이버 유입 원인 미확정"], todos: [{ title: "네이버 유입 분석", assignee: "에릭", dueDate: "", dueLabel: "이번주" }], mode: "local" };
    },
  });
  const body = await (await ctx.api.POST(incoming({ text: "/회의기록 마이인 광고 예산은 20만원으로 유지하기로 했다. 네이버 유입 원인은 아직 모른다." }))).json();
  assert.equal(body.meetingRecorded, true);
  assert.equal(body.meetingId, "meeting-1");
  assert.equal(body.rawDocumentId, "raw-doc-1");
  assert.equal(body.summaryDocumentId, "summary-doc-1");
  const meetingInsert = ctx.inserts.find((insert) => insert.table === "os_records" && insert.payload.record_type === "meeting").payload;
  assert.equal(meetingInsert.brand, "마이인"); assert.equal(meetingInsert.status, "done");
  const decisionInsert = ctx.inserts.find((insert) => insert.table === "os_records" && insert.payload.record_type === "decision").payload;
  assert.equal(decisionInsert.parent_id, "meeting-1");
  const taskInsert = ctx.inserts.find((insert) => insert.table === "os_records" && insert.payload.record_type === "task").payload;
  assert.equal(taskInsert.parent_id, "meeting-1"); assert.equal(taskInsert.metadata.assigneeName, "에릭");
  const documentInserts = ctx.inserts.filter((insert) => insert.table === "os_documents").map((insert) => insert.payload);
  assert.equal(documentInserts.length, 2);
  const rawInsert = documentInserts.find((doc) => doc.source === "meeting_raw");
  assert.match(rawInsert.folder, /^01_Raw\/주간회의\/\d{4}-\d{2}$/);
  assert.equal(rawInsert.status, "draft"); assert.equal(rawInsert.source_ref, "meeting-1");
  assert.match(rawInsert.content_md, /광고 예산은 20만원으로 유지하기로 했다/);
  const summaryInsert = documentInserts.find((doc) => doc.source === "meeting_summary");
  assert.match(summaryInsert.folder, /^02_Wiki\/마이인\/운영\/주간회의요약\/\d{4}-\d{2}$/);
  assert.equal(summaryInsert.status, "draft"); assert.equal(summaryInsert.source_ref, "meeting-1");
  assert.match(summaryInsert.content_md, /광고 예산 20만원 유지/);
  assert.match(summaryInsert.title, /^주간 회의 요약 \(마이인\(진단\)\) — \d{4}-\d{2}-\d{2}$/);
  assert.match(ctx.sent[0].text, /결정사항 1개/);
  assert.match(ctx.sent[0].text, /knowledge\?document=summary-doc-1/);
  assert.match(ctx.sent[0].text, /knowledge\?document=raw-doc-1/);
});

test("회의기록 files a non-마이인/브랜디에듀 meeting under the 회사(전체) knowledge folder", async () => {
  const ctx = await setup("webhook", (query) => {
    if (query.table === "os_documents") {
      const insertOp = query.operations.find((op) => op.method === "insert");
      return { data: { id: insertOp.args[0].source === "meeting_raw" ? "raw-doc-2" : "summary-doc-2" }, error: null };
    }
    if (query.table !== "os_records") return normalHandler(query);
    const insertOp = query.operations.find((op) => op.method === "insert");
    if (!insertOp) return { data: null, error: null };
    return { data: { id: `${insertOp.args[0].record_type}-2` }, error: null };
  }, {
    summarizeMeetingText: async () => ({ summary: "- 콘텐츠 방향 확정", decisions: [], pending: [], todos: [], mode: "local" }),
  });
  const body = await (await ctx.api.POST(incoming({ text: "/회의기록 회사 이번주 콘텐츠 운영 방향을 이렇게 정리했다." }))).json();
  assert.equal(body.meetingRecorded, true);
  const meetingInsert = ctx.inserts.find((insert) => insert.table === "os_records" && insert.payload.record_type === "meeting").payload;
  assert.equal(meetingInsert.brand, "브랜디액션");
  const summaryInsert = ctx.inserts.find((insert) => insert.table === "os_documents" && insert.payload.source === "meeting_summary").payload;
  assert.match(summaryInsert.folder, /^02_Wiki\/회사\/운영\/주간회의요약\/\d{4}-\d{2}$/);
  assert.match(summaryInsert.title, /브랜디액션\(전체\)/);
});

test("resending the same Telegram message does not create a second meeting", async () => {
  const ctx = await setup("webhook", (query) => {
    if (query.table === "os_records" && query.operations.some((op) => op.method === "eq" && op.args[0] === "metadata->>telegramReceipt")) return { data: { id: "meeting-existing" }, error: null };
    return normalHandler(query);
  });
  const body = await (await ctx.api.POST(incoming({ text: "/회의기록 마이인 광고 예산은 20만원으로 유지하기로 했다." }))).json();
  assert.equal(body.meetingRecorded, true);
  assert.equal(ctx.inserts.filter((insert) => insert.table === "os_records" && insert.payload.record_type === "meeting").length, 0);
  assert.match(ctx.sent[0].text, /이미 기록된 회의입니다/);
});

test("회의기록 with decisions offers one batch confirm button for the operating-standard candidate", async () => {
  const ctx = await setup("webhook", (query) => {
    if (query.table !== "os_records") return normalHandler(query);
    const insertOp = query.operations.find((op) => op.method === "insert");
    if (!insertOp) return { data: null, error: null }; // duplicate-check select finds nothing
    return { data: { id: `${insertOp.args[0].record_type}-1` }, error: null };
  }, {
    summarizeMeetingText: async () => ({ summary: "요약", decisions: ["광고 예산 20만원 유지", "네이버 유입 캠페인 신규 진행"], pending: [], todos: [], mode: "local" }),
  });
  await ctx.api.POST(incoming({ text: "/회의기록 마이인 광고 예산은 20만원으로 유지하기로 했다. 네이버 유입 캠페인도 새로 진행한다." }));
  const opsMessages = ctx.sent.filter((m) => m.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data?.startsWith("ops:"));
  assert.equal(opsMessages.length, 1); // one batch confirm, not one per decision
  assert.match(opsMessages[0].text, /이 회의 결정 2건을 운영안에 반영할까요/);
  assert.match(opsMessages[0].text, /광고 예산 20만원 유지/);
  assert.match(opsMessages[0].text, /네이버 유입 캠페인 신규 진행/);
  const pendingTurn = ctx.inserts.find((item) => item.table === "os_channel_turns" && item.payload.answer === "TELEGRAM_OPS_PENDING");
  assert.deepEqual(pendingTurn.payload.metadata.decisions, ["광고 예산 20만원 유지", "네이버 유입 캠페인 신규 진행"]);
  assert.equal(pendingTurn.payload.metadata.business.recordBrand, "마이인");
});

test("confirming the operating-standard batch saves the raw 운영안 doc and synthesizes a fresh 운영 기준 when none existed", async () => {
  let opsInsert = null; let baselineInsert = null;
  const ctx = await setup("webhook", (query) => {
    if (query.table === "os_telegram_users") return { data: { status: "approved", profile_id: "member-profile" }, error: null };
    if (query.table === "os_channel_turns" && query.operations.some((op) => op.method === "select")) {
      return { data: { id: 71, external_chat_id: "30", question: "마이인(진단) 회의 결정 2건", answer: "TELEGRAM_OPS_PENDING", metadata: { business: { recordBrand: "마이인", wikiFolderSegment: "마이인", label: "마이인(진단)" }, decisions: ["광고 예산 20만원 유지", "네이버 유입 캠페인 신규 진행"], meetingDate: "2026-09-22", expiresAt: "2099-01-01T00:00:00Z" } }, error: null };
    }
    if (query.table === "os_documents") {
      if (query.operations.some((op) => op.method === "insert")) {
        const insertOp = query.operations.find((op) => op.method === "insert");
        if (insertOp.args[0].source === "meeting_decision_ops") { opsInsert = insertOp.args[0]; return { data: { id: "ops-doc-1" }, error: null }; }
        baselineInsert = insertOp.args[0];
        return { data: { id: "baseline-doc-1" }, error: null };
      }
      return { data: null, error: null }; // no existing baseline yet
    }
    return { data: null, error: null };
  }, {
    synthesizeOperatingBaseline: async (label, newDocs, existingBody) => {
      assert.equal(label, "마이인(진단)");
      assert.equal(existingBody, "");
      assert.equal(newDocs[0].number, 1);
      return "[광고]\n- 예산 20만원으로 유지 ⟨1⟩\n- 네이버 유입 캠페인 신규 진행 ⟨1⟩";
    },
  });
  const body = await (await ctx.api.POST(callbackIncoming("ops:71:confirm"))).json();
  assert.equal(body.opsApplied, true);
  assert.equal(opsInsert.folder, "02_Wiki/마이인/운영/운영안");
  assert.match(opsInsert.content_md, /광고 예산 20만원 유지/);
  assert.equal(baselineInsert.folder, "02_Wiki/마이인/운영");
  assert.equal(baselineInsert.status, "team");
  assert.match(baselineInsert.content_md, /예산 20만원으로 유지 ⟨1⟩/);
  assert.match(baselineInsert.content_md, /⟨1⟩ 2026-09-22 회의 결정 \(마이인\(진단\)\)/);
  assert.ok(ctx.telegramCalls.some((call) => call.method === "sendMessage" && call.body.text.includes("운영 기준 갱신됨")));
});

test("confirming a second operating-standard batch updates the existing 운영 기준 instead of creating another one", async () => {
  const existingLedger = [{ number: 1, title: "2026-09-01 회의 결정 (마이인(진단))", appliedAt: "2026-09-01T00:00:00Z" }];
  const existingContent = `# 운영 기준 (마이인(진단))\n\n[광고]\n- 예산 30만원으로 유지 ⟨1⟩\n\n────────────────────────\n📄 출처\n⟨1⟩ 2026-09-01 회의 결정 (마이인(진단))\n\n<!-- ledger:${JSON.stringify(existingLedger)}-->`;
  let baselineUpdate = null;
  const ctx = await setup("webhook", (query) => {
    if (query.table === "os_telegram_users") return { data: { status: "approved", profile_id: "member-profile" }, error: null };
    if (query.table === "os_channel_turns" && query.operations.some((op) => op.method === "select")) {
      return { data: { id: 72, external_chat_id: "30", question: "마이인(진단) 회의 결정 1건", answer: "TELEGRAM_OPS_PENDING", metadata: { business: { recordBrand: "마이인", wikiFolderSegment: "마이인", label: "마이인(진단)" }, decisions: ["광고 예산 20만원으로 인하"], meetingDate: "2026-09-22", expiresAt: "2099-01-01T00:00:00Z" } }, error: null };
    }
    if (query.table === "os_documents") {
      if (query.operations.some((op) => op.method === "insert")) return { data: { id: "ops-doc-2" }, error: null };
      if (query.operations.some((op) => op.method === "update")) { baselineUpdate = query.operations.find((op) => op.method === "update").args[0]; return { data: {}, error: null }; }
      return { data: { id: "baseline-doc-1", content_md: existingContent, current_version: 5 }, error: null };
    }
    return { data: null, error: null };
  }, {
    synthesizeOperatingBaseline: async (_label, newDocs, existingBody) => {
      assert.equal(newDocs[0].number, 2); // continues from the existing ledger's max number
      assert.match(existingBody, /예산 30만원으로 유지 ⟨1⟩/);
      return "[광고]\n- 예산 20만원으로 인하 ⟨2⟩\n  대체: ~~예산 30만원으로 유지 ⟨1⟩~~";
    },
  });
  const body = await (await ctx.api.POST(callbackIncoming("ops:72:confirm"))).json();
  assert.equal(body.opsApplied, true);
  assert.equal(body.baselineDocumentId, "baseline-doc-1"); // updated, not a new document
  assert.equal(baselineUpdate.current_version, 6);
  assert.match(baselineUpdate.content_md, /⟨1⟩ 2026-09-01 회의 결정 \(마이인\(진단\)\)/);
  assert.match(baselineUpdate.content_md, /⟨2⟩ 2026-09-22 회의 결정 \(마이인\(진단\)\)/);
});

test("cancelling the operating-standard batch never writes to os_documents", async () => {
  const ctx = await setup("webhook", (query) => {
    if (query.table === "os_telegram_users") return { data: { status: "approved", profile_id: "member-profile" }, error: null };
    if (query.table === "os_channel_turns" && query.operations.some((op) => op.method === "select")) {
      return { data: { id: 73, external_chat_id: "30", question: "마이인(진단) 회의 결정 1건", answer: "TELEGRAM_OPS_PENDING", metadata: { business: { recordBrand: "마이인", wikiFolderSegment: "마이인", label: "마이인(진단)" }, decisions: ["결정"], meetingDate: "2026-09-22" } }, error: null };
    }
    return { data: null, error: null };
  });
  const body = await (await ctx.api.POST(callbackIncoming("ops:73:cancel"))).json();
  assert.equal(body.cancelled, true);
  assert.equal(ctx.inserts.some((item) => item.table === "os_documents"), false);
});

test("운영기준 [사업] shows the saved baseline without calling the synthesizer (free lookup)", async () => {
  const existingContent = "# 운영 기준 (마이인(진단))\n\n[광고]\n- 예산 20만원으로 인하 ⟨2⟩\n\n────────────────────────\n📄 출처\n⟨2⟩ 2026-09-22 회의 결정 (마이인(진단))\n\n<!-- ledger:[]-->";
  let synthesizeCalled = false;
  const ctx = await setup("webhook", (query) => {
    if (query.table === "os_documents") return { data: { content_md: existingContent }, error: null };
    return normalHandler(query);
  }, { synthesizeOperatingBaseline: async () => { synthesizeCalled = true; return null; } });
  const body = await (await ctx.api.POST(incoming({ text: "/운영기준 마이인" }))).json();
  assert.equal(body.operatingBaselineView, true);
  assert.match(ctx.sent[0].text, /지금 유효한 운영 기준/);
  assert.match(ctx.sent[0].text, /예산 20만원으로 인하/);
  assert.doesNotMatch(ctx.sent[0].text, /ledger:/);
  assert.equal(synthesizeCalled, false);
});

test("an OS action command creates only a pending draft with an explicit confirmation button", async () => {
  const ctx = await setup("webhook", normalHandler);
  const body = await (await ctx.api.POST(incoming({ text: "/업무 랜딩 초안 검토 @worker 2026-09-25" }))).json();
  assert.equal(body.actionPending, true);
  assert.equal(ctx.inserts.filter((item) => item.table === "os_records").length, 0);
  const draft = ctx.inserts.find((item) => item.table === "os_channel_turns").payload.metadata.draft;
  assert.equal(draft.title, "랜딩 초안 검토");
  assert.equal(draft.assigneeUsername, "worker");
  assert.equal(ctx.sent[0].reply_markup.inline_keyboard[0][0].callback_data, "act:71:confirm");
});

test("confirming an action button creates one attributable OS record", async () => {
  const draft = { kind: "task", title: "랜딩 초안 검토", assigneeUsername: "", dueDate: null, recordType: "task", status: "backlog" };
  const ctx = await setup("webhook", (query) => {
    if (query.table === "os_telegram_users") return { data: { status: "approved", profile_id: "member-profile" }, error: null };
    if (query.table === "os_channel_turns" && query.operations.some((op) => op.method === "select")) return { data: { id: 71, external_chat_id: "30", question: "/업무 랜딩 초안 검토", answer: "TELEGRAM_ACTION_PENDING", metadata: { draft, expiresAt: "2099-01-01T00:00:00Z" } }, error: null };
    if (query.table === "os_records" && query.operations.some((op) => op.method === "insert")) return { data: { id: "record-1" }, error: null };
    if (query.table === "os_records") return { data: null, error: null };
    return { data: null, error: null };
  });
  const body = await (await ctx.api.POST(callbackIncoming("act:71:confirm"))).json();
  assert.equal(body.created, true);
  const record = ctx.inserts.find((item) => item.table === "os_records").payload;
  assert.equal(record.created_by, "member-profile");
  assert.equal(record.metadata.telegramTurnId, 71);
  assert.ok(ctx.telegramCalls.some((call) => call.method === "editMessageText"));
});

test("negative answer feedback is stored and opens a deduplicated review task", async () => {
  const ctx = await setup("webhook", (query) => {
    if (query.table === "os_telegram_users") return { data: { status: "approved", profile_id: "member-profile" }, error: null };
    if (query.table === "os_channel_turns") return { data: { id: 71, external_chat_id: "30", question: "기준?", answer: "답", source_document_ids: ["doc-1"] }, error: null };
    if (query.table === "os_records") return query.operations.some((op) => op.method === "insert") ? { data: { id: "task-1" }, error: null } : { data: null, error: null };
    return { data: null, error: null };
  });
  const body = await (await ctx.api.POST(callbackIncoming("fb:71:wrong"))).json();
  assert.equal(body.feedback, "wrong");
  assert.ok(ctx.calls.some((query) => query.table === "os_telegram_feedback" && query.operations.some((op) => op.method === "upsert")));
  assert.equal(ctx.inserts.find((item) => item.table === "os_records").payload.metadata.kind, "telegram_answer_feedback");
});

test("a reply to the bot retrieves with the prior question and logs the reply relationship", async () => {
  const related = { documentId: "procedure-doc", title: "패키징_절차", heading: "순서", text: "두 번째 단계는 카피 후보 작성이다", citation: { version: 1, chunkId: 1 }, score: 1 };
  const ctx = await setup("webhook", (query) => {
    if (query.table === "os_channel_turns" && query.operations.some((op) => op.method === "select") && !query.operations.some((op) => op.method === "insert")) return { data: { question: "썸네일 만드는 순서 알려줘", answer: "1. 후보 2. 검토" }, error: null };
    return normalHandler(query);
  }, { searchResults: [related] });
  await ctx.api.POST(incoming({ text: "그중 2번을 자세히", reply_to_message: { message_id: 99, from: { is_bot: true, username: "our_bot" } } }));
  assert.match(ctx.searchCalls[0].query, /썸네일 만드는 순서/);
  const turn = ctx.inserts.find((item) => item.table === "os_channel_turns").payload;
  assert.equal(turn.reply_to_message_id, 99);
  assert.equal(turn.metadata.kind, "knowledge_followup");
});

test("a labelled nonsense question never cites semantically-near but lexically unrelated knowledge", async () => {
  const unrelated = { documentId: "unrelated-doc", title: "현재기준", heading: "본문", text: "유튜브 운영 판정 숫자와 썸네일 기준", citation: { version: 1, chunkId: 1 }, score: 0.03 };
  const ctx = await setup("webhook", normalHandler, { searchResults: [unrelated] });
  const question = "[운영검수 2026-09-09] 푸른삼각형을 내일로 접어줘";
  const body = await (await ctx.api.POST(incoming({ text: question }))).json();
  assert.equal(body.ok, true);
  assert.match(ctx.sent[0].text, /찾지 못했습니다/);
  assert.doesNotMatch(ctx.sent[0].text, /근거 답변/);
  const turn = ctx.inserts.find((insert) => insert.table === "os_channel_turns").payload;
  assert.equal(turn.source_document_ids.length, 0);
});

test("a labelled question keeps knowledge that has literal evidence", async () => {
  const related = { documentId: "related-doc", title: "HTML 보고서", heading: "구성", text: "HTML 보고서 구성 원칙", citation: { version: 1, chunkId: 2 }, score: 0.03 };
  const ctx = await setup("webhook", normalHandler, { searchResults: [related] });
  await ctx.api.POST(incoming({ text: "[운영검수] HTML 보고서 구성 알려줘" }));
  assert.match(ctx.sent[0].text, /근거 답변/);
  const turn = ctx.inserts.find((insert) => insert.table === "os_channel_turns").payload;
  assert.equal(turn.source_document_ids[0], "related-doc");
});

test("a bare topic keyword does not inject an unrelated live-operations listing when grounded knowledge already answers the question", async () => {
  const related = { documentId: "cadence-doc", title: "현재기준", heading: "케이던스", text: "하한: 주 2편. 콘텐츠 편성 최소 기준은 이 값을 따른다", citation: { version: 1, chunkId: 5 }, score: 0.4 };
  const ctx = await setup("webhook", (q) => q.table === "os_records"
    ? { data: [{ title: "다른 콘텐츠", status: "제작", stage: "", brand: "", team: "", due_date: null, progress: 0, updated_at: "2026-09-01" }], error: null }
    : normalHandler(q), { searchResults: [related] });
  const body = await (await ctx.api.POST(incoming({ text: "콘텐츠 편성 하한이 주 몇 편이야?" }))).json();
  assert.equal(body.ok, true);
  assert.match(ctx.sent[0].text, /근거 답변/);
  assert.doesNotMatch(ctx.sent[0].text, /브랜디 OS의 최신/);
});

test("a cadence question rejects generic content hits and sends the rare answer chunk first", async () => {
  const generic = { documentId: "generic-doc", title: "콘텐츠 아이디어", heading: "운영", text: "콘텐츠 제작 사례", citation: { version: 1, chunkId: 3 }, score: 0.8 };
  const scheduling = { documentId: "scheduling-doc", title: "기획_절차", heading: "운영 규칙", text: "승인된 편성을 보존한다.", citation: { version: 1, chunkId: 4 }, score: 0.7 };
  const cadence = { documentId: "cadence-doc", title: "현재기준", heading: "3. 콘텐츠 위계 · 케이던스", text: "하한: 주 2편.", citation: { version: 1, chunkId: 5 }, score: 0.4 };
  const ctx = await setup("webhook", normalHandler, { searchResults: [generic, scheduling, cadence] });
  await ctx.api.POST(incoming({ text: "콘텐츠 편성 하한이 주 몇 편이야?" }));
  assert.equal(ctx.searchCalls[0].topK, 30);
  assert.equal(ctx.answeredWith[0][0].documentId, "cadence-doc");
  assert.deepEqual(Array.from(ctx.inserts.find((insert) => insert.table === "os_channel_turns").payload.source_document_ids), ["cadence-doc", "scheduling-doc"]);
});

test("a thumbnail how-to question retrieves the governing packaging procedure outside the broad candidate window", async () => {
  const analysis = { documentId: "analysis-doc", chunkId: 1, title: "분석_절차", folder: "02_Wiki/콘텐츠/제작기준/콘텐츠절차", heading: "Packaging 관련", text: "썸네일을 분석한다.", citation: { version: 1, chunkId: 1 }, score: 0.8 };
  const procedure = { documentId: "procedure-doc", chunkId: 2, title: "패키징_절차", folder: "02_Wiki/콘텐츠/제작기준/콘텐츠절차", heading: "현행 적용 — 카피를 받쳐주는 인물 컷", text: "썸네일은 사람과 카피 중심으로 만든다.", citation: { version: 1, chunkId: 2 }, score: 0.5 };
  const ctx = await setup("webhook", normalHandler, { searchResults: (input) => input.query === "패키징_절차 사람 카피" ? [procedure] : [analysis] });
  await ctx.api.POST(incoming({ text: "썸네일은 어떻게 만들어야 돼?" }));
  assert.equal(ctx.searchCalls.length, 2);
  assert.equal(ctx.searchCalls[1].query, "패키징_절차 사람 카피");
  assert.equal(ctx.answeredWith[0][0].documentId, "procedure-doc");
});

test("Telegram caps the widened candidate pool after evidence reranking", async () => {
  const results = Array.from({ length: 12 }, (_, index) => ({
    documentId: `doc-${index}`,
    title: "현재기준",
    heading: "콘텐츠 편성",
    text: `하한 기준 ${index}`,
    citation: { version: 1, chunkId: index + 1 },
    score: 1 - index / 100,
  }));
  const ctx = await setup("webhook", normalHandler, { searchResults: results });
  await ctx.api.POST(incoming({ text: "콘텐츠 편성 하한 알려줘" }));
  assert.equal(ctx.answeredWith[0].length, 8);
  assert.equal(ctx.inserts.find((insert) => insert.table === "os_channel_turns").payload.source_document_ids.length, 8);
});

test("a bare topic keyword still surfaces the live-operations listing when no grounded knowledge answers the question", async () => {
  const ctx = await setup("webhook", (q) => q.table === "os_records"
    ? { data: [{ title: "사무직의 종말", status: "제작", stage: "", brand: "", team: "", due_date: null, progress: 0, updated_at: "2026-09-01" }], error: null }
    : normalHandler(q), { searchResults: [] });
  const body = await (await ctx.api.POST(incoming({ text: "지금 진행 중인 콘텐츠 무엇있어?" }))).json();
  assert.equal(body.ok, true);
  assert.match(ctx.sent[0].text, /브랜디 OS의 최신 콘텐츠입니다/);
});
