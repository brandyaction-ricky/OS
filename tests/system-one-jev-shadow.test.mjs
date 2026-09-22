import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { canUseSystemOneJevShadow } from "../lib/system-one-jev-shadow-gate.ts";
import { buildJevPackagingState, evaluateJevPackagingShadow, JEV_PACKAGING_SHADOW_CONTRACT, JEV_SYSTEM_ONE_ENDPOINT } from "../lib/server/system-one-jev-shadow.ts";

const ref = "abcdefghijklmnopqrst";
const prod = "bcdefghijklmnopqrstu";
const baseEnv = {
  SYSTEM_ONE_JEV_SHADOW_ENABLED: "true", NEXT_PUBLIC_SYSTEM_ONE_JEV_SHADOW_ENABLED: "true",
  OS_ENVIRONMENT: "development", NEXT_PUBLIC_DEMO_MODE: "false", TYPESAFE_API_KEY: "synthetic",
  SYSTEM_ONE_DEV_SUPABASE_REF: ref, SYSTEM_ONE_PRODUCTION_SUPABASE_REF: prod,
  NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public",
  NODE_ENV: "development",
};
const material = { title: "AI 변화", thumbnailCopy: "사무직 3가지 미래", audience: "직장인", coreContent: "복수 시나리오를 비교한다.",
  evidenceNotes: "사실, 시나리오, 해석을 구분한다.", viewerPromise: "세 가지 경로와 준비 기준을 제공한다." };
const score = (value, confidence = 0.8) => ({ type: "score", score: value, confidence,
  probabilities: { "0": 0, "1": 0, "2": 0.1, "3": 0.8, "4": 0.1 },
  legend: { "0": "매우 낮음", "1": "낮음", "2": "보통", "3": "높음", "4": "매우 높음" } });
const response = {
  model: "jev-1.13.0", answers: { topic_relevance: score(3.1), thumbnail_clarity: score(2.2),
    curiosity_strength: score(3), evidence_boundary: score(3.8),
    overclaim_risk: { type: "choice", choice: "low", confidence: 0.5, probabilities: { low: 0.6, medium: 0.39, high: 0.01 }, stats: {} } },
  usage: { input_tokens: 100, output_tokens: 50 },
};

test("JEV shadow gate is DEV/QA-only, preview-only when deployed, and fail-closed", () => {
  assert.equal(canUseSystemOneJevShadow(baseEnv), true);
  for (const change of [
    { SYSTEM_ONE_JEV_SHADOW_ENABLED: "false" }, { TYPESAFE_API_KEY: "" }, { OS_ENVIRONMENT: "production" },
    { NEXT_PUBLIC_SUPABASE_URL: `https://${prod}.supabase.co` }, { SYSTEM_ONE_PRODUCTION_SUPABASE_REF: ref },
    { VERCEL: "1", VERCEL_ENV: "production" }, { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "main" },
  ]) assert.equal(canUseSystemOneJevShadow({ ...baseEnv, ...change }), false);
  assert.equal(canUseSystemOneJevShadow({ ...baseEnv, VERCEL: "1", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "codex/jev-shadow" }), true);
});

test("state builder is bounded, explicit and contains no implicit identifiers", () => {
  const state = buildJevPackagingState(material);
  assert.match(state, /제목: AI 변화/); assert.match(state, /썸네일 카피: 사무직 3가지 미래/);
  assert.doesNotMatch(state, /sourceId|owner_id|request_id/);
  assert.throws(() => buildJevPackagingState({ ...material, evidenceNotes: "" }));
  assert.throws(() => buildJevPackagingState({ ...material, extra: "not allowed" }));
});

test("adapter sends one typed request and returns a non-authoritative normalized result", async () => {
  let calls = 0;
  const result = await evaluateJevPackagingShadow(material, { apiKey: "private-key", fetcher: async (url, init) => {
    calls++;
    assert.equal(url, JEV_SYSTEM_ONE_ENDPOINT); assert.equal(init.method, "POST");
    assert.equal(init.headers.authorization, "Bearer private-key");
    const body = JSON.parse(init.body); assert.equal(body.model, "jev-latest"); assert.equal(Object.keys(body.questions).length, 5);
    assert.equal(body.questions.overclaim_risk.type, "choice"); assert.match(body.state, /복수 시나리오/);
    return Response.json(response);
  } });
  assert.equal(calls, 1); assert.equal(result.contractVersion, JEV_PACKAGING_SHADOW_CONTRACT);
  assert.equal(result.mode, "shadow"); assert.equal(result.policyStatus, "pilot_noncanonical");
  assert.equal(result.executionAllowed, false); assert.equal(result.judgment, null);
  assert.equal(result.overclaimRisk.choice, "low"); assert.equal(result.scores.evidenceBoundary.score, 3.8);
  assert.equal(JSON.stringify(result).includes("private-key"), false);
});

test("adapter fails closed on provider and schema errors", async () => {
  await assert.rejects(() => evaluateJevPackagingShadow(material, { apiKey: "", fetcher: async () => Response.json(response) }), /JEV_NOT_CONFIGURED/);
  await assert.rejects(() => evaluateJevPackagingShadow(material, { apiKey: "key", fetcher: async () => new Response("denied", { status: 401 }) }), /JEV_PROVIDER_HTTP_401/);
  await assert.rejects(() => evaluateJevPackagingShadow(material, { apiKey: "key", fetcher: async () => Response.json({ ...response, answers: { ...response.answers, overclaim_risk: { ...response.answers.overclaim_risk, choice: "approve" } } }) }), /JEV_INVALID_RESPONSE/);
});

test("route and UI keep the experiment read-only and server-side", async () => {
  const route = await readFile(new URL("../app/api/v1/system-one/jev-shadow/route.ts", import.meta.url), "utf8");
  const ui = await readFile(new URL("../components/content-jev-shadow-check.tsx", import.meta.url), "utf8");
  assert.match(route, /if \(!token \|\| token\.startsWith\("bos_pat_"\)\) return stopped\("authentication_failed", 401\)/);
  assert.match(route, /allowAgent: false/); assert.match(route, /eq\("owner_id", actor\.id\)/);
  assert.match(route, /name === "TimeoutError"/);
  assert.match(route, /provider_response_invalid/); assert.match(route, /provider_rate_limited/);
  assert.match(route, /shadowEvaluation/); assert.doesNotMatch(route, /insert\(|update\(|upsert\(|service_role/);
  assert.match(ui, /모델 결과를 보기 전에 사람 판정을 고정/); assert.match(ui, /평가 데이터로 저장되지 않습니다/);
  assert.match(ui, /사람 판정 5개를 먼저 입력/); assert.match(ui, /승인·저장·단계 이동에는 사용하지 않습니다/);
  assert.match(ui, /active\.current\?\.abort\(\)/);
  assert.match(ui, /provider_auth_failed/); assert.match(ui, /provider_response_invalid/);
  assert.doesNotMatch(ui, /TYPESAFE_API_KEY/);
});
