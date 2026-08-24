import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AUTOMATION_STAGES,
  completeAutomationStage,
  connectorStatus,
  contentProgressUpdates,
  extractQuestions,
  milestoneDefinition,
  normalizeAutomationState,
  responseText,
  resultMarkdown,
} from "../api/automation.mjs";

test("API stage registry matches the process pipeline", async () => {
  const pipeline = JSON.parse(await readFile(new URL("../03_processes/longform/YOUTUBE_PIPELINE.json", import.meta.url), "utf8"));
  assert.deepEqual(AUTOMATION_STAGES.map((stage) => stage.id), pipeline.stages.map((stage) => stage.id));
  assert.deepEqual(AUTOMATION_STAGES.map((stage) => stage.dependsOn), pipeline.stages.map((stage) => stage.dependsOn));
});

test("normalizeAutomationState unlocks independent parallel stages", () => {
  const state = normalizeAutomationState({
    stages: {
      input_intake: { status: "completed" },
    },
  }, "BA-0268");
  assert.equal(state.stages.subtitle_cleanup.status, "ready");
  assert.equal(state.stages.capture_cards.status, "ready");
  assert.equal(state.stages.media_processing.status, "ready");
  assert.equal(state.stages.deck_authoring.status, "locked");
});

test("completeAutomationStage unlocks dependency graph", () => {
  const state = normalizeAutomationState({ stages: { input_intake: { status: "completed" } } }, "BA-0268");
  completeAutomationStage(state, "subtitle_cleanup", { actor: "jay", outputPath: "result.md" });
  assert.equal(state.stages.deck_authoring.status, "ready");
  assert.equal(state.stages.youtube_assets.status, "ready");
  assert.equal(state.stages.subtitle_cleanup.outputPath, "result.md");
});

test("connectorStatus returns booleans without secrets", () => {
  const status = connectorStatus({
    GITHUB_TOKEN: "github-secret",
    OPENAI_API_KEY: "openai-secret",
    VIDEO_WORKER_WEBHOOK_URL: "https://worker.example",
    VIDEO_WORKER_SECRET: "worker-secret",
    VIDEO_CALLBACK_SECRET: "callback-secret",
  });
  assert.equal(status.openai.ready, true);
  assert.equal(status.render.ready, true);
  assert.equal(status.youtube.ready, false);
  assert.equal(JSON.stringify(status).includes("openai-secret"), false);
});

test("resultMarkdown creates a valid automation result manifest", () => {
  const markdown = resultMarkdown({
    contentId: "BA-0268",
    stageId: "subtitle_cleanup",
    actor: "jay",
    provider: "openai",
    version: 1,
    status: "completed",
    output: "## 정리된 SRT\n\n완료",
    assetUrl: null,
    createdAt: "2026-08-24T06:00:00.000Z",
  });
  assert.match(markdown, /entity_type: automation_result/);
  assert.match(markdown, /id: BA-0268-subtitle_cleanup-run-1/);
  assert.match(markdown, /## 정리된 SRT/);
});

test("responseText extracts Responses API output", () => {
  assert.equal(responseText({ output_text: " ready " }), "ready");
  assert.equal(responseText({ output: [{ content: [{ type: "output_text", text: "done" }] }] }), "done");
});

test("extractQuestions separates unresolved AI decisions", () => {
  assert.deepEqual(extractQuestions("## 결과\n\n완료\n\n## 확인 필요\n\n- 인명 철자 확인\n- 출처 URL 확인"), ["인명 철자 확인", "출처 URL 확인"]);
  assert.deepEqual(extractQuestions("## 확인 필요\n\n- 없음"), []);
});

test("content progress follows automation milestones", () => {
  const state = normalizeAutomationState({ stages: { input_intake: { status: "completed" } } }, "BA-0268");
  state.stages.final_render_qa.status = "completed";
  assert.equal(contentProgressUpdates(state).current_step, "thumbnail");
  state.stages.thumbnail_title.status = "completed";
  assert.equal(contentProgressUpdates(state).current_step, "approval");
  state.stages.youtube_publish.status = "queued";
  assert.equal(contentProgressUpdates(state).current_step, "publish");
  state.stages.youtube_publish.status = "completed";
  assert.equal(contentProgressUpdates(state).current_step, "metrics");
  state.stages.metrics.status = "completed";
  assert.equal(contentProgressUpdates(state).status, "completed");
});

test("milestones create canonical process artifacts", () => {
  const before = normalizeAutomationState({ stages: { input_intake: { status: "completed" }, final_render_qa: { status: "needs_decision" } } }, "BA-0268");
  const after = structuredClone(before);
  after.stages.final_render_qa.status = "completed";
  assert.equal(milestoneDefinition(before, after, "final_render_qa").pointer, "latest_edit");
  const publishBefore = structuredClone(after);
  publishBefore.stages.youtube_publish.status = "needs_decision";
  const publishAfter = structuredClone(publishBefore);
  publishAfter.stages.youtube_publish.status = "queued";
  assert.equal(milestoneDefinition(publishBefore, publishAfter, "youtube_publish").pointer, "latest_approval");
});
