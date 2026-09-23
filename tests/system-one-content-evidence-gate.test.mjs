import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { canUseSystemOneContentEvidence } from "../lib/system-one-content-evidence-gate.ts";
import { canUseSystemOnePreflight } from "../lib/system-one-preflight-gate.ts";

const dev = "a".repeat(20);
const production = "b".repeat(20);
const environment = (patch = {}) => ({
  SYSTEM_ONE_PREFLIGHT_ENABLED: "true", OS_ENVIRONMENT: "qa", NEXT_PUBLIC_DEMO_MODE: "false",
  SYSTEM_ONE_DEV_SUPABASE_REF: dev, SYSTEM_ONE_PRODUCTION_SUPABASE_REF: production,
  NEXT_PUBLIC_SUPABASE_URL: `https://${dev}.supabase.co`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-public",
  VERCEL: "1", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "codex/system-one-preflight-20260920",
  ...patch,
});

test("manual evidence remains available in verified DEV Preview with unrelated external credentials", () => {
  const env = environment({ ANTHROPIC_API_KEY: "synthetic-private", TYPESAFE_API_KEY: "synthetic-private" });
  assert.equal(canUseSystemOnePreflight(env), false);
  assert.equal(canUseSystemOneContentEvidence(env), true);
  assert.equal(canUseSystemOneContentEvidence(environment({ SYSTEM_ONE_PREFLIGHT_ENABLED: "false", SYSTEM_ONE_JEV_SHADOW_ENABLED: "true" })), true);
});

test("manual evidence gate rejects Production, main, demo, missing opt-in and wrong DEV binding", () => {
  assert.equal(canUseSystemOneContentEvidence({}), false);
  for (const patch of [
    { SYSTEM_ONE_PREFLIGHT_ENABLED: "false" }, { OS_ENVIRONMENT: "production" }, { NEXT_PUBLIC_DEMO_MODE: "true" },
    { VERCEL_ENV: "production" }, { VERCEL_GIT_COMMIT_REF: "main" }, { VERCEL_GIT_COMMIT_REF: "refs/heads/master" },
    { VERCEL_TARGET_ENV: "production" }, { SYSTEM_ONE_DEV_SUPABASE_REF: production },
    { SYSTEM_ONE_PRODUCTION_SUPABASE_REF: dev }, { NEXT_PUBLIC_SUPABASE_URL: `https://${production}.supabase.co` },
    { SUPABASE_URL: `https://${production}.supabase.co` }, { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" },
  ]) assert.equal(canUseSystemOneContentEvidence(environment(patch)), false, JSON.stringify(patch));
});

test("the evidence-only UI does not turn on JEV or preflight tools", async () => {
  const page = await readFile(new URL("../app/(os)/[stage]/[page]/page.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../components/content-planning-handoff.tsx", import.meta.url), "utf8");
  const scripts = await readFile(new URL("../components/content-pipeline-workspaces.tsx", import.meta.url), "utf8");
  assert.match(page, /canUseSystemOneContentEvidence\(process.env\)/);
  assert.match(scripts, /evidenceOnly=\{!showPlanningHandoff\} showEvidence=\{showContentEvidence\}/);
  assert.match(panel, /showEvidence \? <>[\s\S]*?<ContentCopyLineage[\s\S]*?<ContentClaimEvidence/);
  assert.match(panel, /!evidenceOnly \? <>[\s\S]*?<ContentJevShadowCheck/);
});
