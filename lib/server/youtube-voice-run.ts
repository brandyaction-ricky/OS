import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import type { OsRecord } from "@/lib/record-types";
import { createServiceSupabase } from "@/lib/supabase/server";
import { buildYoutubeAutomationPlan } from "@/lib/youtube-automation-plan";
import type { RequestActor } from "./auth";
import { readPipeline } from "./content-pipeline";
import { splitFishNarration } from "./fish-audio";
import { hasClaudeKey } from "./content-model";
import { readYoutubeSceneRules, scenePlanSchema } from "./youtube-scenes";
import { YOUTUBE_VISUAL_TEMPLATE_VERSION } from "@/lib/youtube-visual-template";

export const YOUTUBE_VOICE_RUN_KIND = "youtube_narration_voice_v1";
export const YOUTUBE_VOICE_BUCKET = "os-youtube-voice";
export const YOUTUBE_VOICE_TIMING_BUCKET = "os-youtube-voice-timing";
export const YOUTUBE_VOICE_TIMING_MODE = "fish_stream_v1";
export const YOUTUBE_VOICE_EXECUTOR_MODEL = "claude-sonnet-5";
// Jobs created before the Claude switch stay readable; the worker treats them as stale.
const LEGACY_VOICE_EXECUTOR_MODEL = "gpt-6-luna";
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const versionRef = z.object({ id: z.string().uuid(), version: z.number().int().positive() }).strict();
const segmentSchema = z.object({
  index: z.number().int().min(0).max(79), textHash: hex,
  status: z.enum(["pending", "ready"]), path: z.string().optional(), bytes: z.number().int().positive().optional(),
  timingPath: z.string().optional(), audioSha256: hex.optional(),
}).strict();
export const voiceRunMetadataSchema = z.object({
  kind: z.literal(YOUTUBE_VOICE_RUN_KIND), runKey: hex, sourceId: z.string().uuid(), inputKey: hex,
  script: versionRef, packaging: versionRef, sceneRuleVersions: z.array(versionRef).length(4),
  scenePlanGeneratedAt: z.string().datetime(), sceneTemplateVersion: z.string().min(1).max(100).optional(),
  voiceReferenceFingerprint: hex, voiceModel: z.string().min(1),
  timingMode: z.literal(YOUTUBE_VOICE_TIMING_MODE).optional(),
  executorModel: z.enum([YOUTUBE_VOICE_EXECUTOR_MODEL, LEGACY_VOICE_EXECUTOR_MODEL]), segments: z.array(segmentSchema).min(1).max(80),
  lunaReview: z.object({ ready: z.boolean(), issues: z.array(z.string().max(300)).max(20), at: z.string().datetime() }).strict().optional(),
  lease: z.object({ token: z.string().uuid(), expiresAt: z.string().datetime() }).strict().optional(),
  attempts: z.number().int().min(0).max(20), lastError: z.object({ code: z.string(), at: z.string().datetime() }).strict().optional(),
}).strict();
export type VoiceRunMetadata = z.infer<typeof voiceRunMetadataSchema>;

export function digestVoiceValue(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function voiceRunId(runKey: string) {
  const bytes = Buffer.from(runKey.slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = bytes.toString("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function voiceSegmentPath(ownerId: string, sourceId: string, runId: string, index: number) {
  return `${ownerId}/${sourceId}/${runId}/${String(index).padStart(3, "0")}.mp3`;
}

export function voiceSegmentTimingPath(ownerId: string, sourceId: string, runId: string, index: number) {
  return `${ownerId}/${sourceId}/${runId}/${String(index).padStart(3, "0")}.json`;
}

export function parseVoiceRun(record: Pick<OsRecord, "metadata">): VoiceRunMetadata {
  const result = voiceRunMetadataSchema.safeParse(record.metadata);
  if (!result.success) throw new ApiError(409, "VOICE_RUN_INVALID", "저장된 음성 제작 작업을 읽을 수 없습니다.");
  return result.data;
}

export function presentVoiceRun(record: OsRecord) {
  const metadata = parseVoiceRun(record);
  return {
    id: record.id, sourceId: metadata.sourceId, status: record.status, stage: record.stage,
    segmentCount: metadata.segments.length, segmentsReady: metadata.segments.filter((segment) => segment.status === "ready").length,
    readyIndexes: metadata.segments.filter((segment) => segment.status === "ready").map((segment) => segment.index),
    needsAttention: metadata.lunaReview?.ready === false ? metadata.lunaReview.issues : [],
    lastErrorCode: metadata.lastError?.code ?? null, createdAt: record.created_at, updatedAt: record.updated_at,
  };
}

export async function createVoiceRun(actor: RequestActor, sourceId: string, inputKey: string) {
  if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 음성 제작 작업을 시작할 수 있습니다.");
  const state = await readPipeline(actor, sourceId);
  if (state.source.owner_id !== actor.id) throw new ApiError(403, "CONTENT_OWNER_REQUIRED", "이 콘텐츠의 소유자만 음성 제작을 시작할 수 있습니다.");
  const plan = buildYoutubeAutomationPlan(state);
  if (!plan.inputKey || plan.inputKey !== inputKey || !plan.script || !plan.packaging)
    throw new ApiError(409, "AUTOMATION_INPUT_CHANGED", "현재 승인된 원고와 패키징을 다시 확인해 주세요.");
  const scenePlan = state.source.metadata.narratedScenePlan as { inputKey?: unknown; generatedAt?: unknown; ruleVersions?: unknown; templateVersion?: unknown; plan?: unknown } | undefined;
  const parsedScenes = scenePlanSchema.safeParse(scenePlan?.plan);
  const generatedAt = typeof scenePlan?.generatedAt === "string" ? scenePlan.generatedAt : "";
  if (!scenePlan || scenePlan.inputKey !== inputKey || scenePlan.templateVersion !== YOUTUBE_VISUAL_TEMPLATE_VERSION ||
    !parsedScenes.success || parsedScenes.data.unresolved.length ||
    parsedScenes.data.scenes.some((scene, index) => scene.segmentIndex !== index) || !Number.isFinite(Date.parse(generatedAt)))
    throw new ApiError(409, "SCENE_PLAN_REQUIRED", "현재 원고의 화면 설계를 완료하고 확인할 항목을 먼저 해결해 주세요.");
  const rules = await readYoutubeSceneRules(actor);
  if (JSON.stringify(scenePlan.ruleVersions) !== JSON.stringify(rules.ruleVersions))
    throw new ApiError(409, "SCENE_RULES_CHANGED", "OS 영상 기준이 변경됐습니다. 화면 설계를 다시 만드세요.");
  const script = state.records.find((record) => record.id === plan.script?.id && record.version === plan.script.version);
  if (!script) throw new ApiError(409, "AUTOMATION_SCRIPT_CHANGED", "승인된 원고를 다시 확인해 주세요.");
  const segments = splitFishNarration(script.description);
  if (segments.length !== parsedScenes.data.scenes.length) throw new ApiError(409, "SCENE_PLAN_MISMATCH", "원고 단락과 장면 수가 다릅니다. 화면 설계를 다시 만드세요.");
  const voiceReference = process.env.FISH_VOICE_REFERENCE_ID?.trim() ?? "";
  const voiceModel = process.env.FISH_TTS_MODEL?.trim() || "s2.1-pro";
  if (!process.env.FISH_API_KEY?.trim() || !voiceReference || !hasClaudeKey())
    throw new ApiError(503, "VOICE_WORKER_NOT_CONFIGURED", "Fish Audio와 Claude API 연결을 확인해 주세요.");
  const { data: bucket, error: bucketError } = await createServiceSupabase().storage.getBucket(YOUTUBE_VOICE_BUCKET);
  if (bucketError || !bucket || bucket.public) throw new ApiError(503, "VOICE_STORAGE_NOT_CONFIGURED", "비공개 음성 저장소를 확인해 주세요.");
  const { data: timingBucket, error: timingBucketError } = await createServiceSupabase().storage.getBucket(YOUTUBE_VOICE_TIMING_BUCKET);
  if (timingBucketError || !timingBucket || timingBucket.public)
    throw new ApiError(503, "VOICE_STORAGE_NOT_CONFIGURED", "비공개 음성 시간표 저장소를 확인해 주세요.");
  const fingerprint = digestVoiceValue(voiceReference);
  const runKey = digestVoiceValue([YOUTUBE_VOICE_RUN_KIND, sourceId, inputKey, rules.ruleVersions,
    generatedAt, YOUTUBE_VISUAL_TEMPLATE_VERSION, voiceModel, fingerprint, YOUTUBE_VOICE_TIMING_MODE, YOUTUBE_VOICE_EXECUTOR_MODEL]);
  const id = voiceRunId(runKey);
  const metadata: VoiceRunMetadata = {
    kind: YOUTUBE_VOICE_RUN_KIND, runKey, sourceId, inputKey, script: plan.script, packaging: plan.packaging,
    sceneRuleVersions: rules.ruleVersions, scenePlanGeneratedAt: generatedAt,
    sceneTemplateVersion: YOUTUBE_VISUAL_TEMPLATE_VERSION, voiceReferenceFingerprint: fingerprint,
    voiceModel, timingMode: YOUTUBE_VOICE_TIMING_MODE, executorModel: YOUTUBE_VOICE_EXECUTOR_MODEL,
    segments: segments.map((text, index) => ({ index, textHash: digestVoiceValue(text), status: "pending" })), attempts: 0,
  };
  const { data, error } = await actor.supabase.from("os_records").insert({
    id, record_type: "ai_job", title: `${state.source.title} · 내레이션 제작`.slice(0, 240),
    description: "승인된 원고를 비공개 음성 자산으로 제작하는 개발 작업입니다.", status: "backlog", stage: "luna_voice_review",
    priority: "normal", brand: state.source.brand, team: state.source.team, owner_id: actor.id,
    parent_id: sourceId, created_by: actor.id, updated_by: actor.id, tags: ["유튜브", "음성제작"], metadata,
  }).select("*").maybeSingle();
  if (!error && data) return { run: presentVoiceRun(data as OsRecord), reused: false };
  if (error?.code !== "23505") throw new ApiError(500, "VOICE_RUN_CREATE_FAILED", "음성 제작 작업을 저장하지 못했습니다.");
  const { data: existing, error: existingError } = await actor.supabase.from("os_records").select("*").eq("id", id).eq("record_type", "ai_job").is("archived_at", null).maybeSingle();
  if (existingError || !existing || parseVoiceRun(existing as OsRecord).runKey !== runKey || existing.owner_id !== actor.id)
    throw new ApiError(409, "VOICE_RUN_CONFLICT", "기존 음성 제작 작업을 확인할 수 없습니다.");
  const prior = parseVoiceRun(existing as OsRecord);
  if (existing.status === "blocked" && prior.lunaReview?.ready !== false &&
    !["VOICE_RUN_STALE", "VOICE_RUN_INVALID", "VOICE_REVIEW_NEEDS_INPUT"].includes(prior.lastError?.code ?? "")) {
    const resumed: VoiceRunMetadata = { ...prior, attempts: 0 };
    delete resumed.lastError;
    const { data: updated, error: updateError } = await actor.supabase.from("os_records").update({
      status: "backlog", stage: prior.lunaReview ? "voice_pending" : "luna_voice_review", metadata: resumed, updated_by: actor.id,
    }).eq("id", id).eq("version", existing.version).eq("owner_id", actor.id).is("archived_at", null).select("*").maybeSingle();
    if (updateError || !updated) throw new ApiError(409, "VOICE_RUN_CONFLICT", "음성 제작 작업이 변경됐습니다. 새로 불러와 주세요.");
    return { run: presentVoiceRun(updated as OsRecord), reused: true, resumed: true };
  }
  return { run: presentVoiceRun(existing as OsRecord), reused: true };
}
