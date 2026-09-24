import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const fileCache = new Map();
for (const path of ["../lib/content-topic-jev-assist-gate.ts", "../lib/server/content-topic-jev-assist.ts"]) fileCache.set(path, await readFile(new URL(path, import.meta.url), "utf8"));
function loadTypeScript(path) {
  const compiled = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fileCache.get(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module: compiled, exports: compiled.exports,
    Buffer,
    require(name) {
      if (name === "zod") return require("zod");
      if (name === "@/lib/server/content-jev-assist") return { JEV_SYSTEM_ONE_ENDPOINT: "https://api.typesafe.ai/v1/systemone" };
      throw Error(name);
    },
  });
  return compiled.exports;
}
const { canUseContentTopicJevAssist } = loadTypeScript("../lib/content-topic-jev-assist-gate.ts");
const { buildContentTopicJevState, CONTENT_TOPIC_JEV_QUESTIONS, CONTENT_TOPIC_JEV_ASSIST_CONTRACT, evaluateContentTopicJev } = loadTypeScript("../lib/server/content-topic-jev-assist.ts");

const dev = "gjmqkrxhoibopmoeiwtd";
const qa = {
  CONTENT_TOPIC_JEV_ASSIST_ENABLED: "true", CONTENT_TOPIC_JEV_DEV_SUPABASE_REF: dev,
  OS_ENVIRONMENT: "qa", NEXT_PUBLIC_DEMO_MODE: "false", TYPESAFE_API_KEY: "synthetic",
  NEXT_PUBLIC_SUPABASE_URL: `https://${dev}.supabase.co`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public",
  VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "codex/jev-topic-planning",
};
const material = {
  topic: "지금 일을 계속해야 하나?", description: "역할과 환경이 맞는지 판단이 막힌 장면",
  audience: "현재 일의 역할과 환경을 고민하는 사람", entryLanguage: "지금 일을 계속해야 하나",
  hierarchy: "유입형", evidence: "고객 사례 메모", sourceUrl: "https://example.com/video",
  researchSources: "https://example.com/research", analystNotes: "비교 영상과 다른 적용 질문",
  planningSummary: "경험을 돌아보고 역할·환경을 구분한다.", handoff: "근거 확인 후 패키징 단계로 전달",
};
const response = { model: "jev-test", answers: Object.fromEntries(Object.keys(CONTENT_TOPIC_JEV_QUESTIONS).map((key) => [key, { type: "choice", choice: key === "evidence" ? "1" : "3", confidence: 0.8 }])) };

test("topic planning JEV has a standalone QA Preview gate bound to the DEV database", () => {
  assert.equal(canUseContentTopicJevAssist(qa), true);
  assert.equal(canUseContentTopicJevAssist({ ...qa, CONTENT_TOPIC_JEV_ASSIST_ENABLED: "false" }), false);
  assert.equal(canUseContentTopicJevAssist({ ...qa, CONTENT_TOPIC_JEV_ASSIST_ENABLED: undefined }), false);
  assert.equal(canUseContentTopicJevAssist({ ...qa, OS_ENVIRONMENT: "production", VERCEL_ENV: "production" }), false);
  assert.equal(canUseContentTopicJevAssist({ ...qa, VERCEL_GIT_COMMIT_REF: "main" }), false);
  assert.equal(canUseContentTopicJevAssist({ ...qa, NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" }), false);
  assert.equal(canUseContentTopicJevAssist({ ...qa, TYPESAFE_API_KEY: "" }), false);
  assert.equal(canUseContentTopicJevAssist({ ...qa, CONTENT_JEV_ASSIST_ENABLED: "false", SYSTEM_ONE_PREFLIGHT_ENABLED: "false", CONTENT_EVIDENCE_ENABLED: "false" }), true);
});

test("TypeSafe state includes only bounded topic-planning fields and marks empty fields unknown", () => {
  assert.equal(CONTENT_TOPIC_JEV_ASSIST_CONTRACT, "jev-content-topic-planning-advisory-v1");
  const state = buildContentTopicJevState(material);
  for (const value of [material.topic, material.audience, material.evidence, material.researchSources, material.planningSummary]) assert.ok(state.includes(value));
  assert.match(state, /제목·썸네일 최종 제작, 원고, 촬영·발행, 발행 후 성과는 평가하지 않는다/);
  assert.doesNotMatch(state, /topicId|owner_id|team_id|brand_id/);
  assert.match(buildContentTopicJevState({ ...material, audience: "", evidence: "", sourceUrl: "" }), /타깃: 미확인/);
  assert.throws(() => buildContentTopicJevState({ ...material, apiKey: "unexpected" }));
});

test("provider adapter returns explainable advisory scores and sends no record identifiers or key in content", async () => {
  let calls = 0;
  const result = await evaluateContentTopicJev(material, { apiKey: "private-key", fetcher: async (url, init) => {
    calls++;
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(init.headers.authorization, "Bearer private-key");
    const body = JSON.parse(init.body);
    assert.equal(Object.keys(body.questions).length, 5);
    assert.match(body.state, /기획 요약: 경험/);
    assert.doesNotMatch(body.state, /private-key|topicId|owner_id/);
    return Response.json(response);
  } });
  assert.equal(calls, 1);
  assert.equal(result.criteria.length, 5);
  assert.equal(result.overallScore, 2.6);
  assert.equal(result.advisoryOnly, true);
  assert.equal(result.saved, false);
  assert.match(result.improvements[0], /주요 주장마다 출처/);
  assert.equal(JSON.stringify(result).includes("private-key"), false);
});

test("route and UI remain read-only and show the TypeSafe transmission scope before consent", async () => {
  const route = await readFile(new URL("../app/api/v1/content/topic-jev-assist/route.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/(os)/[stage]/[page]/page.tsx", import.meta.url), "utf8");
  const ui = await readFile(new URL("../components/content-topic-jev-assist.tsx", import.meta.url), "utf8");
  assert.match(route, /if \(!canUseContentTopicJevAssist\(process\.env\)\)/);
  assert.match(route, /allowAgent: false/);
  assert.match(route, /actor\.supabase\.from\("os_records"\)/);
  assert.match(route, /metadata->>packageKind/);
  assert.doesNotMatch(route, /service_role|\.insert\(|\.update\(|\.upsert\(/);
  assert.match(page, /showTopicJevAssist=\{contentTopicJevAssistEnabled\}/);
  assert.match(ui, /TypeSafe JEV로 전송됩니다/);
  assert.match(ui, /개인정보·비밀/);
  assert.match(ui, /주제를 채택하거나 보류하지 않습니다/);
  assert.match(ui, /저장·승인·채택·기획 확정·단계 이동을 하지 않습니다/);
  assert.doesNotMatch(ui, /TYPESAFE_API_KEY/);
});
