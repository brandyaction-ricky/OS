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

const PDF_STAGE_IDS = [
  "subtitle_review",
  "summary_deck",
  "photo_prompts",
  "render_insert",
  "capture_cards",
  "media_processing",
  "xml_assembly",
  "youtube_assets",
];

const completedPdfStages = () => Object.fromEntries(PDF_STAGE_IDS.map((stageId) => [stageId, { status: "completed" }]));

test("API stage registry matches the process pipeline", async () => {
  const pipeline = JSON.parse(await readFile(new URL("../03_processes/longform/YOUTUBE_PIPELINE.json", import.meta.url), "utf8"));
  assert.equal(pipeline.id, "youtube-production-v2");
  assert.deepEqual(AUTOMATION_STAGES.map((stage) => stage.id), pipeline.stages.map((stage) => stage.id));
  assert.deepEqual(AUTOMATION_STAGES.map((stage) => stage.dependsOn), pipeline.stages.map((stage) => stage.dependsOn));
  assert.deepEqual(AUTOMATION_STAGES.map((stage) => stage.provider), pipeline.stages.map((stage) => stage.provider));
  assert.deepEqual(AUTOMATION_STAGES.map((stage) => stage.humanGate), pipeline.stages.map((stage) => stage.humanGate));
  assert.equal(pipeline.stages.length, 20);
  assert.deepEqual(pipeline.stages.slice(1, 9).map((stage) => stage.id), PDF_STAGE_IDS);
  assert.equal(pipeline.originalProcess.steps.length, 8);
  assert.equal(pipeline.originalProcess.absoluteRules.length, 11);
  assert.deepEqual(pipeline.thumbnailLoop.steps.map((step) => step.label), ["아이디어", "AI 생성", "AI 평가", "사람 승인", "업로드", "CTR 측정", "학습"]);
});

test("multichannel repurposing pipeline keeps three independent branches", async () => {
  const pipeline = JSON.parse(await readFile(new URL("../03_processes/longform/REPURPOSING_PIPELINE.json", import.meta.url), "utf8"));
  assert.equal(pipeline.stages.length, 15);
  assert.equal(pipeline.defaults.shortsCount, 3);
  assert.deepEqual(pipeline.defaults.shortDestinations, ["youtube_shorts", "instagram_reels"]);
  assert.equal(pipeline.defaults.carouselCount, 1);
  assert.deepEqual(pipeline.defaults.threadsMix, { single: 2, thread: 1 });
  assert.deepEqual(pipeline.stages.find((stage) => stage.id === "multichannel_metrics").dependsOn, ["shorts_publish", "carousel_publish", "threads_publish"]);
});

test("normalizeAutomationState starts the first independent PDF stage", () => {
  const state = normalizeAutomationState({
    stages: {
      source_package: { status: "completed" },
    },
  }, "BA-0268");
  assert.equal(state.pipelineId, "youtube-production-v2");
  assert.equal(state.stages.subtitle_review.status, "ready");
  assert.equal(state.stages.summary_deck.status, "locked");
  assert.equal(state.stages.master_upload.status, "locked");
  assert.equal(state.stages.shortform_plan.status, "locked");
});

test("completeAutomationStage unlocks dependency graph", () => {
  const state = normalizeAutomationState({ stages: { source_package: { status: "completed" } } }, "BA-0268");
  completeAutomationStage(state, "subtitle_review", { actor: "jay", outputPath: "subtitle-review.md" });
  assert.equal(state.stages.summary_deck.status, "ready");
  completeAutomationStage(state, "summary_deck", { actor: "jay", outputPath: "summary-deck.md" });
  assert.equal(state.stages.photo_prompts.status, "ready");
  assert.equal(state.stages.render_insert.status, "locked");
  completeAutomationStage(state, "photo_prompts", { actor: "jay", outputPath: "photo-prompts.md" });
  completeAutomationStage(state, "render_insert", { actor: "jay", outputPath: "render-insert.md" });
  completeAutomationStage(state, "capture_cards", { actor: "jay", outputPath: "capture-cards.md" });
  completeAutomationStage(state, "media_processing", { actor: "jay", outputPath: "media-processing.md" });
  completeAutomationStage(state, "xml_assembly", { actor: "jay", outputPath: "xml-assembly.md" });
  assert.equal(state.stages.youtube_assets.status, "ready");
  completeAutomationStage(state, "youtube_assets", { actor: "jay", outputPath: "youtube-assets.md" });
  assert.equal(state.stages.master_upload.status, "ready");
  assert.equal(state.stages.master_validation.status, "locked");
  assert.equal(state.stages.subtitle_review.outputPath, "subtitle-review.md");
  completeAutomationStage(state, "master_upload", { actor: "jay", outputPath: "master-upload.md", assetUrl: "asset://longform/BA-0268/master-v1.mp4" });
  assert.equal(state.stages.master_validation.status, "ready");
  assert.equal(state.stages.master_upload.assetUrl, "asset://longform/BA-0268/master-v1.mp4");
  completeAutomationStage(state, "master_validation", { actor: "system", outputPath: "master-validation.md" });
  assert.equal(state.stages.thumbnail_idea.status, "ready");
  assert.equal(state.stages.shortform_plan.status, "ready");
});

test("legacy combined PDF completion migrates without resetting progress", () => {
  const state = normalizeAutomationState({ stages: {
    source_package: { status: "completed" },
    pc_main_edit: { status: "completed", outputPath: "legacy-pc-edit.md", completedBy: "jay" },
  } }, "BA-0268");
  for (const stageId of PDF_STAGE_IDS) {
    assert.equal(state.stages[stageId].status, "completed");
    assert.equal(state.stages[stageId].outputPath, "legacy-pc-edit.md");
  }
  assert.equal(state.stages.master_upload.status, "ready");
  assert.equal(state.stages.pc_main_edit, undefined);
});

test("thumbnail loop blocks publish until human approval and closes after learning", () => {
  const state = normalizeAutomationState({ stages: {
    source_package: { status: "completed" },
    ...completedPdfStages(),
    master_upload: { status: "completed", assetUrl: "asset://longform/BA-0268/master.mp4" },
    master_validation: { status: "completed" },
    shortform_plan: { status: "completed" },
    shortform_render: { status: "completed" },
  } }, "BA-0268");
  assert.equal(state.stages.thumbnail_idea.status, "ready");
  assert.equal(state.stages.youtube_publish.status, "locked");
  completeAutomationStage(state, "thumbnail_idea", { actor: "jay", outputPath: "idea.md" });
  completeAutomationStage(state, "thumbnail_generate", { actor: "system", outputPath: "generate.md", assetUrl: "asset://longform/BA-0268/thumbnails/manifest.json" });
  completeAutomationStage(state, "thumbnail_evaluate", { actor: "system", outputPath: "evaluate.md" });
  assert.equal(state.stages.thumbnail_approve.status, "ready");
  completeAutomationStage(state, "thumbnail_approve", { actor: "ricky", outputPath: "approve.md", assetUrl: "asset://longform/BA-0268/thumbnails/a.png" });
  assert.equal(state.stages.youtube_publish.status, "ready");
  completeAutomationStage(state, "youtube_publish", { actor: "ricky", outputPath: "publish.md", assetUrl: "https://youtube.com/watch?v=example" });
  completeAutomationStage(state, "metrics", { actor: "system", outputPath: "metrics.md" });
  assert.equal(state.stages.thumbnail_learn.status, "ready");
  completeAutomationStage(state, "thumbnail_learn", { actor: "system", outputPath: "learn.md" });
  assert.equal(state.status, "completed");
});

test("connectorStatus returns booleans without secrets", () => {
  const status = connectorStatus({
    GITHUB_TOKEN: "github-secret",
    OS_PUSH_SECRET: "session-secret",
    ASSET_UPLOAD_SESSION_URL: "https://assets.example/session",
    ASSET_UPLOAD_SERVICE_SECRET: "asset-secret",
    OPENAI_API_KEY: "openai-secret",
    VIDEO_WORKER_WEBHOOK_URL: "https://worker.example",
    VIDEO_WORKER_SECRET: "worker-secret",
    VIDEO_CALLBACK_SECRET: "callback-secret",
    THUMBNAIL_WORKER_WEBHOOK_URL: "https://thumbnail.example",
    THUMBNAIL_WORKER_SECRET: "thumbnail-secret",
    THUMBNAIL_CALLBACK_SECRET: "thumbnail-callback-secret",
  });
  assert.equal(status.session.ready, true);
  assert.equal(status.asset.ready, true);
  assert.equal(status.openai.ready, true);
  assert.equal(status.render.ready, true);
  assert.equal(status.thumbnail.ready, true);
  assert.equal(status.youtube.ready, false);
  assert.equal(JSON.stringify(status).includes("openai-secret"), false);
});

test("resultMarkdown creates a valid automation result manifest", () => {
  const markdown = resultMarkdown({
    contentId: "BA-0268",
    stageId: "shortform_plan",
    actor: "jay",
    provider: "openai",
    version: 1,
    status: "completed",
    output: "## 정리된 SRT\n\n완료",
    assetUrl: null,
    createdAt: "2026-08-24T06:00:00.000Z",
  });
  assert.match(markdown, /entity_type: automation_result/);
  assert.match(markdown, /id: BA-0268-shortform_plan-run-1/);
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
  const state = normalizeAutomationState({ stages: { source_package: { status: "completed" } } }, "BA-0268");
  state.stages.master_upload.status = "completed";
  assert.equal(contentProgressUpdates(state).current_step, "thumbnail");
  state.stages.thumbnail_approve.status = "completed";
  state.stages.youtube_assets.status = "completed";
  assert.equal(contentProgressUpdates(state).current_step, "approval");
  state.stages.youtube_publish.status = "queued";
  assert.equal(contentProgressUpdates(state).current_step, "publish");
  state.stages.youtube_publish.status = "completed";
  assert.equal(contentProgressUpdates(state).current_step, "metrics");
  state.stages.metrics.status = "completed";
  assert.equal(contentProgressUpdates(state).status, "in_progress");
  state.stages.thumbnail_learn.status = "completed";
  assert.equal(contentProgressUpdates(state).status, "completed");
});

test("milestones create canonical process artifacts", () => {
  const before = normalizeAutomationState({ stages: { source_package: { status: "completed" }, master_upload: { status: "ready" } } }, "BA-0268");
  const after = structuredClone(before);
  after.stages.master_upload.status = "completed";
  const master = milestoneDefinition(before, after, "master_upload");
  assert.equal(master.pointer, "latest_edit");
  assert.equal(master.alsoPointer, "latest_master");

  const thumbnailBefore = structuredClone(after);
  thumbnailBefore.stages.thumbnail_approve.status = "ready";
  const thumbnailApproved = structuredClone(thumbnailBefore);
  thumbnailApproved.stages.thumbnail_approve.status = "completed";
  assert.equal(milestoneDefinition(thumbnailBefore, thumbnailApproved, "thumbnail_approve").pointer, "latest_thumbnail");

  const publishBefore = structuredClone(after);
  publishBefore.stages.youtube_publish.status = "needs_decision";
  const approved = structuredClone(publishBefore);
  approved.stages.youtube_publish.status = "queued";
  assert.equal(milestoneDefinition(publishBefore, approved, "youtube_publish").pointer, "latest_approval");

  const published = structuredClone(approved);
  published.stages.youtube_publish.status = "completed";
  assert.equal(milestoneDefinition(approved, published, "youtube_publish").pointer, "latest_publish");

  const measured = structuredClone(published);
  measured.stages.metrics.status = "completed";
  assert.equal(milestoneDefinition(published, measured, "metrics").pointer, "latest_metrics");
});
