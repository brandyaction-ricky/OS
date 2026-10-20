import assert from "node:assert/strict";
import test from "node:test";
import { canUseYoutubeAutomationPilot, canUseYoutubeStaffScript } from "../lib/youtube-automation-gate.ts";

// ② 원고 by staff AI may open in Production on its own switch; the rest of the automation only on the production switch.
const production = { VERCEL: "1", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main", OS_ENVIRONMENT: "production", NEXT_PUBLIC_DEMO_MODE: "false",
  YOUTUBE_AUTOMATION_PILOT_ENABLED: "true", NEXT_PUBLIC_SUPABASE_URL: "https://prodprodprodprodprod.supabase.co",
  YOUTUBE_AUTOMATION_DEV_SUPABASE_REF: "devdevdevdevdevdevde", YOUTUBE_AUTOMATION_PRODUCTION_SUPABASE_REF: "prodprodprodprodprod" };

test("production keeps the pilot shut and opens staff scripts only on their switch", () => {
  assert.equal(canUseYoutubeAutomationPilot(production), false);
  assert.equal(canUseYoutubeStaffScript(production), false);
  assert.equal(canUseYoutubeStaffScript({ ...production, YOUTUBE_STAFF_SCRIPT_ENABLED: "true" }), true);
  assert.equal(canUseYoutubeAutomationPilot({ ...production, YOUTUBE_STAFF_SCRIPT_ENABLED: "true" }), false);
});

test("production opens the automation only on its own switch, on the production project and deployment", () => {
  const open = { ...production, YOUTUBE_AUTOMATION_PRODUCTION_ENABLED: "true" };
  assert.equal(canUseYoutubeAutomationPilot(open), true);
  assert.equal(canUseYoutubeStaffScript(open), true);
  assert.equal(canUseYoutubeAutomationPilot({ ...open, VERCEL_ENV: "preview" }), false);
  assert.equal(canUseYoutubeAutomationPilot({ ...open, NEXT_PUBLIC_SUPABASE_URL: "https://devdevdevdevdevdevde.supabase.co" }), false);
  assert.equal(canUseYoutubeAutomationPilot({ ...open, OS_ENVIRONMENT: "development" }), false);
  assert.equal(canUseYoutubeAutomationPilot({ ...open, NEXT_PUBLIC_DEMO_MODE: "true" }), false);
});

test("where the DEV pilot runs, staff scripts run too", () => {
  const dev = { ...production, VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "codex/x", OS_ENVIRONMENT: "development",
    NEXT_PUBLIC_SUPABASE_URL: "https://devdevdevdevdevdevde.supabase.co" };
  assert.equal(canUseYoutubeAutomationPilot(dev), true);
  assert.equal(canUseYoutubeStaffScript(dev), true);
});
