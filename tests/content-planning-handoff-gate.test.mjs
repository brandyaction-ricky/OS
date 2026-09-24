import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { canUseContentPlanningHandoff } from "../lib/content-planning-handoff-gate.ts";

const dev = "a".repeat(20);
const production = "b".repeat(20);
const previewEnvironment = (patch = {}) => ({
  CONTENT_PLANNING_HANDOFF_ENABLED: "true", OS_ENVIRONMENT: "qa", NEXT_PUBLIC_DEMO_MODE: "false",
  SYSTEM_ONE_DEV_SUPABASE_REF: dev, SYSTEM_ONE_PRODUCTION_SUPABASE_REF: production,
  NEXT_PUBLIC_SUPABASE_URL: `https://${dev}.supabase.co`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-public",
  VERCEL: "1", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "codex/content-workflow-prod-gate-20260924",
  ...patch,
});
const productionEnvironment = (patch = {}) => ({
  CONTENT_PLANNING_HANDOFF_ENABLED: "true", OS_ENVIRONMENT: "production", NEXT_PUBLIC_DEMO_MODE: "false",
  SYSTEM_ONE_DEV_SUPABASE_REF: dev, SYSTEM_ONE_PRODUCTION_SUPABASE_REF: production,
  NEXT_PUBLIC_SUPABASE_URL: `https://${production}.supabase.co`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-public",
  VERCEL: "1", VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
  ...patch,
});

test("planning handoff is available only after explicit opt-in and correct Preview/DEV binding", () => {
  assert.equal(canUseContentPlanningHandoff(previewEnvironment()), true);
  assert.equal(canUseContentPlanningHandoff({}), false);
  for (const patch of [
    { CONTENT_PLANNING_HANDOFF_ENABLED: "false" }, { NEXT_PUBLIC_DEMO_MODE: "true" },
    { VERCEL_ENV: "production" }, { VERCEL_GIT_COMMIT_REF: "main" },
    { NEXT_PUBLIC_SUPABASE_URL: `https://${production}.supabase.co` },
    { SUPABASE_URL: `https://${production}.supabase.co` }, { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" },
  ]) assert.equal(canUseContentPlanningHandoff(previewEnvironment(patch)), false, JSON.stringify(patch));
});

test("Production handoff requires explicit opt-in, Production deployment, main commit, and Production Supabase", () => {
  assert.equal(canUseContentPlanningHandoff(productionEnvironment()), true);
  for (const patch of [
    { CONTENT_PLANNING_HANDOFF_ENABLED: "false" }, { VERCEL_ENV: "preview" },
    { VERCEL_TARGET_ENV: "preview" }, { VERCEL_GIT_COMMIT_REF: "codex/feature" },
    { NEXT_PUBLIC_SUPABASE_URL: `https://${dev}.supabase.co` },
    { SUPABASE_URL: `https://${dev}.supabase.co` }, { OS_ENVIRONMENT: "qa" },
  ]) assert.equal(canUseContentPlanningHandoff(productionEnvironment(patch)), false, JSON.stringify(patch));
});

test("Production has no implicit fallback when deployment identity is missing", () => {
  const env = productionEnvironment({ VERCEL: "", VERCEL_ENV: "", VERCEL_TARGET_ENV: "", VERCEL_URL: "", VERCEL_DEPLOYMENT_ID: "", VERCEL_GIT_COMMIT_REF: "", NODE_ENV: "production" });
  assert.equal(canUseContentPlanningHandoff(env), false);
});

test("topic, handoff, evidence, preflight, and JEV presentation use independent gates", async () => {
  const page = await readFile(new URL("../app/(os)/[stage]/[page]/page.tsx", import.meta.url), "utf8");
  const topic = await readFile(new URL("../components/content-radar-workspace.tsx", import.meta.url), "utf8");
  const scripts = await readFile(new URL("../components/content-pipeline-workspaces.tsx", import.meta.url), "utf8");
  const handoff = await readFile(new URL("../components/content-planning-handoff.tsx", import.meta.url), "utf8");
  assert.match(page, /showPlanningHandoff={contentPlanningHandoffEnabled} showReferenceCheck={systemOnePreflightEnabled}/);
  assert.match(page, /showContentEvidence={contentEvidenceEnabled} showSystemOnePreflight={systemOnePreflightEnabled} showSystemOneJevShadow={systemOneJevShadowEnabled}/);
  assert.match(topic, /showReferenceCheck \? <SystemOnePlanningCheck/);
  assert.match(topic, /showPlanningHandoff \? <ContentPlanningHandoff/);
  assert.match(scripts, /showPlanningHandoff=\{showPlanningHandoff\} showEvidence=\{showContentEvidence\}[^>]*showSystemOnePreflight=\{showSystemOnePreflight\} showSystemOneJevShadow=\{showSystemOneJevShadow\}/);
  assert.match(handoff, /showSystemOneJevShadow \? <ContentJevShadowCheck/);
  assert.match(handoff, /showSystemOnePreflight \? <>[\s\S]*?<ContentStageReference[\s\S]*?<ContentReviewContext/);
  assert.match(handoff, /showEvidence \? <>[\s\S]*?<ContentCopyLineage[\s\S]*?<ContentClaimEvidence/);
});
