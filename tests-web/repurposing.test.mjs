import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  REPURPOSING_STAGES,
  displayRepurposingStages,
  normalizeRepurposingState,
  repurposingConnectorStatus,
  repurposingResultMarkdown,
} from "../api/repurposing.mjs";

test("runtime registry matches the canonical repurposing pipeline", async () => {
  const pipeline = JSON.parse(await readFile(new URL("../03_processes/longform/REPURPOSING_PIPELINE.json", import.meta.url), "utf8"));
  assert.deepEqual(REPURPOSING_STAGES.map((stage) => stage.id), pipeline.stages.map((stage) => stage.id));
  assert.deepEqual(REPURPOSING_STAGES.map((stage) => stage.provider), pipeline.stages.map((stage) => stage.provider));
  assert.deepEqual(REPURPOSING_STAGES.map((stage) => stage.dependsOn), pipeline.stages.map((stage) => stage.dependsOn));
});

test("source intake opens content DNA without falsely unlocking downstream stages", () => {
  const state = normalizeRepurposingState({ sourceReady: true }, "BA-0268");
  assert.equal(state.status, "ready");
  assert.equal(state.stages.content_dna.status, "ready");
  assert.equal(state.stages.atom_extract.status, "locked");
  assert.equal(state.stages.shorts_plan.status, "locked");
});

test("youtube completion can activate the expansion run", () => {
  const state = normalizeRepurposingState(null, "BA-0268", { triggerReady: true });
  assert.equal(state.sourceReady, true);
  assert.equal(state.stages.content_dna.status, "ready");
});

test("UI differentiates dependency wait from missing connector setup", () => {
  const state = normalizeRepurposingState({ sourceReady: true }, "BA-0268");
  const stages = displayRepurposingStages(state, { GITHUB_TOKEN: "github" });
  assert.equal(stages.find((stage) => stage.id === "content_dna").displayStatus, "needs_setup");
  assert.equal(stages.find((stage) => stage.id === "atom_extract").displayStatus, "waiting_dependency");
});

test("connector status never exposes secrets", () => {
  const status = repurposingConnectorStatus({
    GITHUB_TOKEN: "github-secret",
    OS_PUSH_SECRET: "session-secret",
    OPENAI_API_KEY: "openai-secret",
    VIDEO_WORKER_WEBHOOK_URL: "https://render.example",
    VIDEO_WORKER_SECRET: "render-secret",
    VIDEO_CALLBACK_SECRET: "callback-secret",
    DESIGN_WORKER_WEBHOOK_URL: "https://design.example",
    DESIGN_WORKER_SECRET: "design-secret",
    DESIGN_CALLBACK_SECRET: "design-callback-secret",
    SOCIAL_PUBLISH_WORKER_URL: "https://publish.example",
    SOCIAL_PUBLISH_WORKER_SECRET: "publish-secret",
    SOCIAL_PUBLISH_CALLBACK_SECRET: "publish-callback-secret",
    MULTICHANNEL_METRICS_WORKER_URL: "https://metrics.example",
    MULTICHANNEL_METRICS_WORKER_SECRET: "metrics-secret",
    MULTICHANNEL_METRICS_CALLBACK_SECRET: "metrics-callback-secret",
  });
  assert.equal(Object.values(status).every((connector) => connector.ready), true);
  assert.equal(JSON.stringify(status).includes("secret"), false);
});

test("runtime result is stored as valid automation Markdown", () => {
  const markdown = repurposingResultMarkdown({
    contentId: "BA-0268",
    stage: REPURPOSING_STAGES[0],
    actor: "jay",
    output: "## 핵심 약속\n\n완료",
    version: 1,
    assetUrl: null,
    status: "completed",
  });
  assert.match(markdown, /entity_type: automation_result/);
  assert.match(markdown, /pipeline_id: multichannel-repurposing-v1/);
  assert.doesNotMatch(markdown, /^\+/m);
});
