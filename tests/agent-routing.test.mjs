import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";

const source = readFileSync(new URL("../lib/server/agent-routing.ts", import.meta.url), "utf8");
const compiled = { exports: {} };
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
  exports: compiled.exports,
  require: (name) => name === "zod" ? { z } : (() => { throw new Error(name); })(),
  process: { env: {} },
  fetch,
  AbortSignal,
});
const { classifyAgentRequest, hasSensitiveRoutingInput, isAgentRequestRoutingEnabled, parseCanonicalAgentRoutes } = compiled.exports;
const mcpSource = readFileSync(new URL("../lib/server/mcp.ts", import.meta.url), "utf8");
const compiledMcp = { exports: {} };
runInNewContext(ts.transpileModule(mcpSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
  exports: compiledMcp.exports,
  require: (name) => name === "zod" ? { z } : (() => { throw new Error(name); })(),
  URLSearchParams,
});

const registry = `
### 9-1. 업무 라우팅
| 호출 이름 | 업무 의미 | 첫 담당 역할 |
|---|---|---|
| \`business-ops\` | 운영·감사·회고·데이터 검증 | \`business.audit\` |
| \`youtube-title-thumbnail\` | 제목·썸네일·패키징 | \`youtube.packaging\` |

### 9-2. 역할 → 원문 등록부
| 역할키 | 대상 doc_id | 담당 범위 | 검색 별칭 |
|---|---|---|---|
| \`business.audit\` | \`bf8e65f5-2ac6-49e7-8183-71ae46782765\` | 운영·데이터 감사 | 별칭 |
| \`youtube.packaging\` | \`1399076c-33c9-4ff1-b4ed-9c81fa8647e3\` | 패키징 | 별칭 |
`;
const confirmedRoutes = () => parseCanonicalAgentRoutes(registry).map((route) => ({
  ...route, documentTitle: route.skillName, documentStatus: "canonical", documentFolder: "test/confirmed",
}));

test("current canonical routing and role tables resolve to current document IDs", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(parseCanonicalAgentRoutes(registry))), [
    { skillName: "business-ops", description: "운영·감사·회고·데이터 검증", roleKey: "business.audit", documentId: "bf8e65f5-2ac6-49e7-8183-71ae46782765" },
    { skillName: "youtube-title-thumbnail", description: "제목·썸네일·패키징", roleKey: "youtube.packaging", documentId: "1399076c-33c9-4ff1-b4ed-9c81fa8647e3" },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(parseCanonicalAgentRoutes("### 9-1. 업무 라우팅\n| `unknown` | 업무 | `missing.role` |"))), []);
});

test("obvious secrets and direct personal identifiers are blocked before JEV processing", () => {
  assert.equal(hasSensitiveRoutingInput("[합성 사례] 담당자 API key=sk-0123456789abcdef"), true);
  assert.equal(hasSensitiveRoutingInput("[합성 사례] 담당자 user@example.com"), true);
  assert.equal(hasSensitiveRoutingInput("[합성 사례] 라우팅 확인"), false);
});

test("the request-routing flag can open only in non-production environments", () => {
  assert.equal(isAgentRequestRoutingEnabled({ AGENT_REQUEST_ROUTING_ENABLED: "true", OS_ENVIRONMENT: "qa", VERCEL_ENV: "preview" }), true);
  assert.equal(isAgentRequestRoutingEnabled({ AGENT_REQUEST_ROUTING_ENABLED: "true", OS_ENVIRONMENT: "production", VERCEL_ENV: "production" }), false);
  assert.equal(isAgentRequestRoutingEnabled({ AGENT_REQUEST_ROUTING_ENABLED: "true", OS_ENVIRONMENT: "qa", VERCEL_ENV: "production" }), false);
  assert.equal(isAgentRequestRoutingEnabled({ AGENT_REQUEST_ROUTING_ENABLED: "false", OS_ENVIRONMENT: "qa", VERCEL_ENV: "preview" }), false);
});

test("synthetic request receives advisory routing and never opens execution permissions", async () => {
  const routes = confirmedRoutes();
  let sent;
  const advice = await classifyAgentRequest("[합성 사례] 운영 데이터 검증 절차를 찾아 주세요.", routes, async (_url, init) => {
    sent = JSON.parse(init.body);
    return Response.json({ answers: {
      request_type: { choice: "work_request", confidence: 0.94 },
      route: { choice: "business.audit", confidence: 0.91 },
      missing_information: { choice: "none", confidence: 0.93 },
      handoff: { choice: "none", confidence: 0.92 },
    } });
  }, "synthetic-key");

  assert.equal(sent.state, "[합성 사례] 운영 데이터 검증 절차를 찾아 주세요.");
  assert.equal(sent.model, "jev-latest");
  assert.equal(advice.route.documentId, "bf8e65f5-2ac6-49e7-8183-71ae46782765");
  assert.equal(advice.advisoryOnly, true);
  assert.equal(advice.executionAllowed, false);
  assert.equal(advice.toolPermissionsGranted, false);
  assert.equal(advice.externalMessagesAllowed, false);
  assert.equal(advice.fileOrDatabaseWritesAllowed, false);
  assert.equal(advice.paymentsOrAdsAllowed, false);
  assert.equal(advice.actionTaken, false);
  assert.equal(advice.permissionsChanged, false);
  assert.equal(advice.handoff, "none");
});

test("uncertain, malformed, unavailable, and unregistered suggestions fail closed", async () => {
  const routes = confirmedRoutes();
  const lowConfidence = await classifyAgentRequest("[합성 사례] 애매한 요청", routes, async () => Response.json({ answers: {
    request_type: { choice: "unclear", confidence: 0.5 }, route: { choice: "business.audit", confidence: 0.5 },
    missing_information: { choice: "none", confidence: 0.5 }, handoff: { choice: "none", confidence: 0.5 },
  } }), "synthetic-key");
  assert.equal(lowConfidence.handoff, "ambiguous_request");
  assert.equal(lowConfidence.missingInformation, "unknown");
  assert.equal(lowConfidence.executionAllowed, false);

  const unknownRoute = await classifyAgentRequest("[합성 사례] 설명해 주세요", routes, async () => Response.json({ answers: {
    request_type: { choice: "question", confidence: 0.9 }, route: { choice: "not_registered", confidence: 0.9 },
    missing_information: { choice: "none", confidence: 0.9 }, handoff: { choice: "none", confidence: 0.9 },
  } }), "synthetic-key");
  assert.equal(unknownRoute.route, null);
  assert.equal(unknownRoute.handoff, "no_matching_route");
  await assert.rejects(() => classifyAgentRequest("[합성 사례]", routes, async () => { throw new Error("offline"); }, "synthetic-key"));
  await assert.rejects(() => classifyAgentRequest("[합성 사례]", routes, async () => Response.json({ answers: {} }), "synthetic-key"));
  await assert.rejects(() => classifyAgentRequest("[합성 사례]", routes, async () => Response.json({ answers: {} }), ""));
});

test("a registered but noncanonical source is surfaced and sent for human review", async () => {
  const routes = confirmedRoutes().map((route) => ({ ...route, documentStatus: "review" }));
  const advice = await classifyAgentRequest("[합성 사례] 확인이 필요한 요청", routes, async () => Response.json({ answers: {
    request_type: { choice: "work_request", confidence: 0.95 }, route: { choice: "business.audit", confidence: 0.95 },
    missing_information: { choice: "none", confidence: 0.95 }, handoff: { choice: "none", confidence: 0.95 },
  } }), "synthetic-key");
  assert.equal(advice.route.documentStatus, "review");
  assert.equal(advice.handoff, "unconfirmed_reference");
  assert.match(advice.rationale, /사람에게 넘겨 주세요/);
});

test("MCP requires explicit external-processing confirmation and only forwards a read-only request", async () => {
  let forwarded;
  const fetchApi = async (path, init) => { forwarded = { path, init }; return { advice: { executionAllowed: false } }; };
  await assert.rejects(() => compiledMcp.exports.callMcpTool({
    name: "classify_request", arguments: { request_text: "[합성 사례] 라우팅 확인" },
  }, "00000000-0000-4000-8000-000000000001", fetchApi));
  assert.equal(forwarded, undefined);

  const result = await compiledMcp.exports.callMcpTool({
    name: "classify_request", arguments: { request_text: "[합성 사례] 라우팅 확인", confirm_external_processing: true },
  }, "00000000-0000-4000-8000-000000000001", fetchApi);
  assert.deepEqual(JSON.parse(JSON.stringify(forwarded)), {
    path: "/api/v1/agent-routing",
    init: { method: "POST", body: JSON.stringify({ organizationId: "00000000-0000-4000-8000-000000000001", requestText: "[합성 사례] 라우팅 확인", confirmExternalProcessing: true }) },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { advice: { executionAllowed: false } });
});

test("server routing gate stays closed by default and makes no registry or provider call", async () => {
  const routeSource = readFileSync(new URL("../app/api/v1/agent-routing/route.ts", import.meta.url), "utf8");
  const routeExports = {};
  let databaseReads = 0;
  let providerCalls = 0;
  const ApiError = class extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } };
  runInNewContext(ts.transpileModule(routeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: routeExports,
    require(name) {
      if (name === "next/server") return { NextResponse: { json: (body, init) => Response.json(body, init) } };
      if (name === "zod") return { z, ZodError: z.ZodError };
      if (name === "@/lib/http") return { ApiError, apiErrorResponse: (error) => Response.json({ error: { code: error.code, message: error.message } }, { status: error.status ?? 500 }) };
      if (name === "@/lib/server/auth") return { authenticateRequest: async () => ({ type: "agent", ownerId: "agent" }) };
      if (name === "@/lib/server/organization") return { assertOrganization: async () => {} };
      if (name === "@/lib/server/agent-routing") return {
        canonicalSkillRegistryDocumentId: "00000000-0000-4000-8000-000000000002",
        parseCanonicalAgentRoutes: () => [],
        hasSensitiveRoutingInput: () => false,
        isAgentRequestRoutingEnabled,
        classifyAgentRequest: async () => { providerCalls++; return {}; },
      };
      if (name === "@/lib/supabase/server") return { createServiceSupabase: () => { databaseReads++; return {}; } };
      throw new Error(name);
    },
    process: { env: { AGENT_REQUEST_ROUTING_ENABLED: "false", OS_ENVIRONMENT: "qa", VERCEL_ENV: "preview" } },
  });
  const response = await routeExports.POST(new Request("https://example.com/api/v1/agent-routing", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ organizationId: "00000000-0000-4000-8000-000000000001", requestText: "[합성 사례] 분류", confirmExternalProcessing: true }),
  }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "AGENT_ROUTE_DISABLED");
  assert.equal(databaseReads, 0);
  assert.equal(providerCalls, 0);
});
