import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as zod from "zod";
import { copyLineageInput } from "../lib/content-copy-lineage.ts";
import { claimEvidenceInput } from "../lib/content-claim-evidence.ts";

const sourceId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const decision = { kind: "decision", sourceId, expectedSourceVersion: 4, decisionAt: "2026-09-04",
  evidenceUrl: "https://example.com/decision", title: "선택하고 나서 후회하는 사람", thumbnailCopy: "답은, 오답 지우기", note: "" };
const claim = { sourceId, expectedSourceVersion: 4, location: "chapter", locationDetail: "8:57", claimText: "상상보다 기억이 2배 정확했다",
  sourceRelation: "candidate", sourceUrl: "https://example.com/paper", sourceIdentifier: "Candidate paper", sourceExcerpt: "",
  measuredConcept: "미래 감정 예측 오차", population: "대학생", sample: "n=25", comparison: "11.42mm vs 22.38mm",
  conditions: "속도 데이트", assessment: "review_needed", rationale: "기억 정확도가 아닌 감정 예측 오차이므로 문구를 재검토해야 합니다." };

class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }

async function harness(routeName, options = {}) {
  const file = routeName === "copy-lineage" ? "copy-lineage" : "claim-evidence";
  const source = await readFile(new URL(`../app/api/v1/content/${file}/route.ts`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const inserted = [];
  const actor = { id: ownerId, type: "user", user: { id: ownerId }, mustChangePassword: false, team: "콘텐츠",
    supabase: { from(table) {
      assert.equal(table, "os_records");
      const checks = [];
      let insertPayload = null;
      const builder = {
        select() { return builder; },
        eq(field, value) { checks.push([field, value]); return builder; },
        is(field, value) { checks.push([field, value]); return builder; },
        async maybeSingle() {
          const row = { id: sourceId, record_type: "content_topic", brand: "브랜디액션", team: "콘텐츠",
            owner_id: options.wrongOwner ? "33333333-3333-4333-8333-333333333333" : ownerId,
            version: options.version ?? 4, archived_at: null };
          return { data: checks.every(([field, value]) => row[field] === value) ? row : null, error: null };
        },
        insert(value) { insertPayload = value; return builder; },
        async single() { inserted.push(insertPayload); return { data: { id: "evidence-id", ...insertPayload }, error: null }; },
      };
      return builder;
    } },
  };
  const modules = {
    "next/server": { NextResponse: Response }, zod,
    "@/lib/content-copy-lineage": { copyLineageInput }, "@/lib/content-claim-evidence": { claimEvidenceInput },
    "@/lib/http": { ApiError, parseJson: request => request.json(), apiErrorResponse: error => Response.json({ error: { message: error.message } }, { status: error.status ?? 500 }) },
    "@/lib/server/auth": { authenticateRequest: async () => actor },
    "@/lib/system-one-jev-shadow-gate": { canUseSystemOneJevShadow: () => options.enabled !== false },
  };
  const commonJsModule = { exports: {} };
  runInNewContext(`(function(require,module,exports){${code}\n})`, {
    Response, process: { env: {} }, require: name => { assert.ok(name in modules, name); return modules[name]; },
  })(name => modules[name], commonJsModule, commonJsModule.exports);
  const call = (body, authorization = "Bearer synthetic") => commonJsModule.exports.POST(new Request(`https://example.com/api/v1/content/${file}`, {
    method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  return { call, inserted };
}

test("copy decision records only owned DEV evidence, never a publication receipt", async () => {
  const h = await harness("copy-lineage");
  const response = await h.call(decision);
  assert.equal(response.status, 201); assert.equal(h.inserted.length, 1);
  assert.equal(h.inserted[0].record_type, "content_package");
  assert.equal(h.inserted[0].metadata.packageKind, "copy_decision_evidence");
  assert.equal(h.inserted[0].metadata.verification, "user_entered");
  assert.equal(h.inserted[0].status, "draft");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});
test("claim card stores candidate as candidate and review-needed as reviewer-entered", async () => {
  const h = await harness("claim-evidence");
  const response = await h.call(claim);
  assert.equal(response.status, 201); assert.equal(h.inserted.length, 1);
  assert.equal(h.inserted[0].metadata.sourceRelation, "candidate");
  assert.equal(h.inserted[0].metadata.assessment, "review_needed");
  assert.equal(h.inserted[0].metadata.verification, "reviewer_entered");
  assert.equal(h.inserted[0].metadata.sourceId, undefined);
});
test("both routes fail before insert on disabled, agent, wrong owner, stale or malformed input", async () => {
  for (const [name, body] of [["copy-lineage", decision], ["claim-evidence", claim]]) {
    for (const [options, patch, authorization, status] of [
      [{ enabled: false }, {}, "Bearer synthetic", 404],
      [{}, {}, "Bearer bos_pat_synthetic", 401],
      [{ wrongOwner: true }, {}, "Bearer synthetic", 404],
      [{ version: 5 }, {}, "Bearer synthetic", 409],
      [{}, { unexpected: "x" }, "Bearer synthetic", 400],
    ]) {
      const h = await harness(name, options);
      assert.equal((await h.call({ ...body, ...patch }, authorization)).status, status);
      assert.equal(h.inserted.length, 0);
    }
  }
});
