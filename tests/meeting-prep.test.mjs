import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// lib/server/meeting-prep.ts uses "@/..." path aliases that Node's native ESM
// loader can't resolve directly (same constraint as the webhook route tests),
// so we transpile + eval with a small mocked require, mirroring
// tests/telegram-request-flow.test.mjs's setup() pattern.
async function loadPrepareMeetingBrief() {
  const source = await readFile(new URL("../lib/server/meeting-prep.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const modules = {
    "@/lib/http": { ApiError: class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } } },
    "@/lib/meeting-business": await import("../lib/meeting-business.ts"),
    "@/lib/performance-signals": await import("../lib/performance-signals.ts"),
  };
  const exports = {};
  runInNewContext(code, { exports, require: (id) => { if (!(id in modules)) throw Error(id); return modules[id]; }, console });
  return exports.prepareMeetingBrief;
}

function fakeSupabase({ meetings = [], tasks = [], kpis = [], documents = [] }) {
  return {
    from(table) {
      const state = { filters: [] };
      const chain = {
        select() { return chain; },
        eq(column, value) { state.filters.push([column, value]); return chain; },
        like(column, pattern) { state.filters.push([column, pattern]); return chain; },
        is() { return chain; },
        neq() { return chain; },
        order() { return chain; },
        limit() { return chain; },
        async maybeSingle() {
          if (table !== "os_documents") return { data: null, error: null };
          const folderFilter = state.filters.find(([column]) => column === "folder")?.[1] ?? "";
          const prefix = folderFilter.replace(/%$/, "");
          const match = documents.find((doc) => doc.folder.startsWith(prefix));
          return { data: match ?? null, error: null };
        },
        then(resolve) {
          if (table !== "os_records") return resolve({ data: [], error: null });
          const recordType = state.filters.find(([column]) => column === "record_type")?.[1];
          const data = recordType === "meeting" ? meetings : recordType === "task" ? tasks : recordType === "kpi" ? kpis : [];
          return resolve({ data, error: null });
        },
      };
      return chain;
    },
  };
}

test("prepareMeetingBrief uses the os_records meeting summary when one exists", async () => {
  const prepareMeetingBrief = await loadPrepareMeetingBrief();
  const supabase = fakeSupabase({ meetings: [{ id: "m1", title: "마이인 회의", status: "done", starts_at: "2026-09-01", metadata: { summary: "구조화된 요약", pending: [] } }] });
  const result = await prepareMeetingBrief(supabase, { brand: "마이인" });
  assert.equal(result.latestMeeting.summary, "구조화된 요약");
  assert.equal(result.latestMeeting.id, "m1");
});

test("prepareMeetingBrief falls back to the knowledge-folder weekly summary when no os_records meeting exists", async () => {
  const prepareMeetingBrief = await loadPrepareMeetingBrief();
  const supabase = fakeSupabase({
    meetings: [],
    documents: [{
      title: "주간 회의 요약 (자영업 교육) — 2026-08-07",
      folder: "02_Wiki/브랜디에듀/운영/주간회의요약/2026-08",
      updated_at: "2026-08-07T00:00:00Z",
      content_md: "# 주간 회의 요약 (자영업 교육) — 2026-08-07\n\n## 핵심 요약\n- 썸네일 회의 일정 잡기\n- KPI 테이블 세팅\n\n## 결정사항\n- (없음)\n\n## 미결사항\n- (없음)",
    }],
  });
  const result = await prepareMeetingBrief(supabase, { brand: "브랜디액션 에듀" });
  assert.ok(result.latestMeeting, "expected a document-derived latestMeeting fallback");
  assert.match(result.latestMeeting.summary, /썸네일 회의 일정 잡기/);
  assert.doesNotMatch(result.latestMeeting.summary, /결정사항/);
  assert.equal(result.latestMeeting.id, "");
  assert.equal(result.latestMeeting.title, "주간 회의 요약 (자영업 교육) — 2026-08-07");
  assert.equal(result.pending.length, 0); // "(없음)" 절은 빈 목록으로 취급
});

test("prepareMeetingBrief also falls back to the document's 미결사항 section for pending items", async () => {
  const prepareMeetingBrief = await loadPrepareMeetingBrief();
  const supabase = fakeSupabase({
    meetings: [],
    documents: [{
      title: "주간 회의 요약 (마이인(진단)) — 2026-09-01",
      folder: "02_Wiki/마이인/운영/주간회의요약/2026-09",
      updated_at: "2026-09-01T00:00:00Z",
      content_md: "# 주간 회의 요약 (마이인(진단)) — 2026-09-01\n\n## 핵심 요약\n- 광고 예산 유지\n\n## 결정사항\n- (없음)\n\n## 미결사항\n- 네이버 유입 원인 미확정\n- 상세페이지 문구 확정 대기",
    }],
  });
  const result = await prepareMeetingBrief(supabase, { brand: "마이인" });
  // runInNewContext gives arrays from a separate VM realm, so compare content
  // via JSON rather than assert.deepEqual (which checks realm-bound identity).
  assert.equal(JSON.stringify(result.pending), JSON.stringify(["네이버 유입 원인 미확정", "상세페이지 문구 확정 대기"]));
  assert.equal(JSON.stringify(result.latestMeeting.pending), JSON.stringify(result.pending));
});

test("prepareMeetingBrief stays empty when neither os_records nor the knowledge folder has anything", async () => {
  const prepareMeetingBrief = await loadPrepareMeetingBrief();
  const supabase = fakeSupabase({ meetings: [], documents: [] });
  const result = await prepareMeetingBrief(supabase, { brand: "마이인" });
  assert.equal(result.latestMeeting, null);
});
