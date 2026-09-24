import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { canUseContentJevAssist } from "../lib/content-jev-assist-gate.ts";
import { buildJevContentAssistState, evaluateJevContentAssist, JEV_CONTENT_ASSIST_CONTRACT, JEV_SYSTEM_ONE_ENDPOINT } from "../lib/server/content-jev-assist.ts";

const dev = "gjmqkrxhoibopmoeiwtd";
const prod = "abcdefghijklmnopqrst";
const base = {
  CONTENT_JEV_ASSIST_ENABLED: "true", OS_ENVIRONMENT: "production", NEXT_PUBLIC_DEMO_MODE: "false", TYPESAFE_API_KEY: "synthetic",
  SYSTEM_ONE_DEV_SUPABASE_REF: dev, SYSTEM_ONE_PRODUCTION_SUPABASE_REF: prod,
  NEXT_PUBLIC_SUPABASE_URL: `https://${prod}.supabase.co`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public",
  VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
};
const material = {
  title: "AI가 사무직을 줄일까?", thumbnailCopy: "사무직, 어디까지 줄어들까",
  audience: "사무직 직장인", coreContent: "고용 시나리오를 살펴본다.",
  evidenceNotes: "전망과 실제 고용 통계를 구분한다.", viewerPromise: "가능한 변화의 경로를 설명한다.",
};
const score = (value = 3) => ({ type: "score", score: value, confidence: 0.8,
  probabilities: { "0": 0, "1": 0.05, "2": 0.1, "3": 0.8, "4": 0.05 },
  legend: { "0": "매우 낮음", "1": "낮음", "2": "보통", "3": "높음", "4": "매우 높음" } });
const providerResponse = { model: "jev-1.13.0", answers: {
  topic_relevance: score(), thumbnail_clarity: score(2.7), curiosity_strength: score(3.4), evidence_boundary: score(2.3),
  overclaim_risk: { type: "choice", choice: "medium", confidence: 0.6, probabilities: { low: 0.1, medium: 0.7, high: 0.2 } },
}, usage: { input_tokens: 100, output_tokens: 50 } };

test("independent JEV gate only opens on explicitly enabled QA Preview or Production main with matching database", () => {
  assert.equal(canUseContentJevAssist(base), true);
  assert.equal(canUseContentJevAssist({ ...base, VERCEL_ENV: "preview" }), false);
  assert.equal(canUseContentJevAssist({ ...base, VERCEL_GIT_COMMIT_REF: "codex/jev-assist" }), false);
  assert.equal(canUseContentJevAssist({ ...base, NEXT_PUBLIC_SUPABASE_URL: `https://${dev}.supabase.co` }), false);
  assert.equal(canUseContentJevAssist({ ...base, CONTENT_JEV_ASSIST_ENABLED: "false" }), false);
  const preview = { ...base, OS_ENVIRONMENT: "qa", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "codex/jev-assist", NEXT_PUBLIC_SUPABASE_URL: `https://${dev}.supabase.co` };
  assert.equal(canUseContentJevAssist(preview), true);
  assert.equal(canUseContentJevAssist({ ...preview, VERCEL_GIT_COMMIT_REF: "main" }), false);
  assert.equal(canUseContentJevAssist({ ...preview, SYSTEM_ONE_DEV_SUPABASE_REF: prod }), false);
  assert.equal(canUseContentJevAssist({ ...base, TYPESAFE_API_KEY: "" }), false);
});

test("JEV state uses only selected content fields and clearly bounded evidence context", () => {
  assert.equal(JEV_CONTENT_ASSIST_CONTRACT, "jev-content-packaging-advisory-v1");
  const state = buildJevContentAssistState(material);
  assert.match(state, /제목: AI가 사무직을 줄일까\?/);
  assert.match(state, /썸네일 카피: 사무직, 어디까지 줄어들까/);
  assert.doesNotMatch(state, /sourceId|owner_id|request_id/);
  assert.throws(() => buildJevContentAssistState({ ...material, coreContent: "" }));
  assert.throws(() => buildJevContentAssistState({ ...material, unexpected: "not allowed" }));
});

test("provider adapter returns scores as advisory only and never includes the server key", async () => {
  let calls = 0;
  const result = await evaluateJevContentAssist(material, { apiKey: "private-key", fetcher: async (url, init) => {
    calls++;
    assert.equal(url, JEV_SYSTEM_ONE_ENDPOINT);
    assert.equal(init.method, "POST");
    assert.equal(init.headers.authorization, "Bearer private-key");
    const body = JSON.parse(init.body);
    assert.equal(body.model, "jev-latest");
    assert.equal(Object.keys(body.questions).length, 5);
    assert.match(body.state, /전망과 실제 고용 통계를 구분한다/);
    return Response.json(providerResponse);
  } });
  assert.equal(calls, 1);
  assert.equal(result.advisoryOnly, true);
  assert.equal(result.saved, false);
  assert.equal(result.overclaimRisk.choice, "medium");
  assert.equal(result.scores.thumbnailClarity.score, 2.7);
  assert.equal(JSON.stringify(result).includes("private-key"), false);
});

test("route is opt-in, authenticated, RLS scoped and has no write or broad DEV gate", async () => {
  const route = await readFile(new URL("../app/api/v1/content/jev-assist/route.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/(os)/[stage]/[page]/page.tsx", import.meta.url), "utf8");
  const ui = await readFile(new URL("../components/content-jev-assist.tsx", import.meta.url), "utf8");
  assert.match(route, /if \(!canUseContentJevAssist\(process\.env\)\)/);
  assert.match(route, /allowAgent: false/);
  assert.match(route, /metadata->>packageKind/);
  assert.match(route, /actor\.supabase\.from\("os_records"\)/);
  assert.doesNotMatch(route, /service_role|\.insert\(|\.update\(|\.upsert\(/);
  assert.match(route, /latestPackage\.version !== selectedPackage\.version/);
  assert.match(page, /showJevAssist=\{contentJevAssistEnabled\}/);
  assert.match(ui, /JEV 점수 보기/);
  assert.match(ui, /TypeSafe JEV로 전송됩니다/);
  assert.match(ui, /승인이나 발행 여부를 결정하지 않습니다/);
  assert.match(ui, /조건이나 근거 단서를 더하라는 의견입니다/);
  assert.match(ui, /핵심 표현을 바꾸라는 의견입니다/);
  assert.doesNotMatch(ui, /TYPESAFE_API_KEY/);
});
