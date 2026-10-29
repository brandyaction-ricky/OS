import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { OsRecord } from "@/lib/record-types";
import type { RequestActor } from "./auth";
import { splitFishNarration } from "./fish-audio";
import { readYoutubeAutomationInput } from "./youtube-automation-input";
import { readPipeline } from "./content-pipeline";
import { assertScriptInputs, saveScriptBundle, scriptBundleSchema, scriptInputKey, scriptJobCard } from "./youtube-script-job";
import { checkScenePlan, SCENE_PLAN_JSON_SCHEMA, scenePlanPrompt, youtubeSceneRuleRefs } from "./youtube-scenes";
import { checkPronunciation, pronunciationPrompt, PRONUNCIATION_JSON_SCHEMA } from "./youtube-voice-worker";
import { YOUTUBE_VISUAL_TEMPLATE_VERSION } from "@/lib/youtube-visual-template";
import { myinRunWithWords, saveMyinStoryboard } from "./myin-run";
import { checkMyinStoryboardResult, checkShortStoryboardResult, MYIN_CARD_DOCS, myinStoryboardCard, myinStoryboardInputKey, SHORT_CARD_DOCS, shortStoryboardCard } from "./myin-storyboard-job";
import { DIAGRAM_CATALOG } from "@/lib/shortform-diagram-catalog";
import { diagramCatalogTypes } from "@/lib/diagram-catalog";
import { readDiagramCatalog } from "./diagram-catalog";
import { assertKitInputs, kitInputKey, kitJobCard, saveStaffKit } from "./youtube-kit-job";
import { assertV1ColumnInputs, assertV1PlanInputs, assertV1RetitleInputs, assertV1ShortsInputs, displayName, isYoutubeV1, saveV1Column, saveV1Plan, saveV1Retitle, saveV1Shorts, v1ColumnCard, v1ColumnInputKey, v1PlanCard, v1PlanInputKey, v1RetitleCard, v1RetitleInputKey, v1ShortsCard, v1ShortsInputKey, v1ShortsSource, v1Stages, v1Title } from "./youtube-process-ai";
import { SLOTS } from "@/lib/youtube-process/stages";
import { packagingPick } from "@/lib/youtube-process/discover";
import { projectName } from "@/lib/youtube-process/project";
import { packagingReferences } from "./youtube-discover";
import type { PackagingMarket } from "./youtube-process-ai";
import { assertShortCopyOpen, assertShortJobOpen, checkShortResult, saveShortCopy, saveShortJob, shortCopyCard, shortCopyInputKey, shortJobCard, shortJobInputKey, shortJobInputs } from "./youtube-process-short";
import { namedProcedures, procedureRefs, SHORTFORM_CANON_TITLE, withNamed } from "./content-generation";
import { checkNicheResult, NICHE_BOARD_ID, nicheBoardRecord, nicheInputKey, nicheJobCard, nichePool, saveNicheBoard } from "./youtube-niche";
import { doneShortRefs } from "./youtube-process-short-refs";
import { assertShortFormulaInputs, assertShortScriptInputs, assertShortTopicsInputs, saveShortFormula, saveShortScript, saveShortTopics, shortFormulaCard, shortFormulaInputKey, shortScriptCard, shortScriptInputKey, shortScriptQuery, shortTopicsCard, shortTopicsInputKey } from "./youtube-process-short-script";
import { refMatchesQuery } from "@/lib/youtube-process/short-script";
import type { NicheVideo } from "@/lib/youtube-process/discover";
import type { GptTier } from "@/lib/youtube-process/gpt-draft";

/** The name a job carries: the adopted title, or a v1 project's confirmed A. */
const jobTitle = (state: Awaited<ReturnType<typeof readPipeline>>) => isYoutubeV1(state.source) ? v1Title(v1Stages(state)) : state.writing.packageTitle || state.source.title;

// Staff AI jobs (owner decision 2026-10-17, method B): the requester's own Claude or Codex reaches the OS through
// MCP with a personal agent key, takes a job, does the text work on its own plan and submits; the OS only checks and stores.
export const STAFF_AI_JOB_KIND = "youtube_staff_ai_v1";
// ③ 화면 설계 is one pass; ② 원고 runs 축 → 설계 → 초안 → 검수 with separate reviews, so it holds the job longer.
const LEASE_MINUTES = { "scene-plan": 30, script: 120, storyboard: 90, kit: 30, plan: 45, shorts: 30, short: 30, niche: 30, column: 90, "short-copy": 20, retitle: 30, "short-topics": 30, "short-formula": 45, "short-script": 45 } as const;
const TASK_NAME = { "scene-plan": "화면 설계와 발음 검토", script: "원고(축 · 설계 · 초안 · 검수)", storyboard: "마이인 기획표(장면 · 비유 · 자료 후보)",
  kit: "유튜브 발행키트(제목 · 설명 · 태그 · 챕터 · 고정 댓글)", plan: "기획안(제목 · 썸네일 문구 · 영상 흐름)", shorts: "쇼츠 구간 제안", column: "SEO 칼럼(HTML)", short: "숏폼 장면(구매 이유 · 자막 · 내레이션 · 필요한 이미지)", "short-copy": "숏폼 제목 · 설명", niche: "틈새 묶기(같은 제목 공식)", retitle: "최종 썸네일 제목 · 문구 다시 뽑기",
  "short-topics": "숏폼 주제 후보(롱폼 원고에서)", "short-formula": "숏폼 공식 · 주제 후보(참고 영상에서)", "short-script": "숏폼 대본(확정한 주제 · 공식으로)" } as const;
const versionRef = z.object({ id: z.string(), version: z.number() });
// 원고 공정 정본 §2 '역할'. ① 기획 has no such field yet, so the staff member picks it when sending ② to their AI.
export const SCRIPT_ROLES = ["유입형", "전환형", "판매형"] as const;
const jobMetaSchema = z.object({
  kind: z.literal(STAFF_AI_JOB_KIND), task: z.enum(["scene-plan", "script", "storyboard", "kit", "plan", "shorts", "short", "niche", "column", "short-copy", "retitle", "short-topics", "short-formula", "short-script"]), sourceId: z.string().uuid(), inputKey: z.string().length(64),
  // ruleVersions only on jobs made before 2026-10-18; a design no longer depends on script rule versions.
  templateVersion: z.string().optional(), ruleVersions: z.array(versionRef).optional(), targetMinutes: z.number().optional(), role: z.enum(SCRIPT_ROLES).optional(), attachments: z.string().optional(), slot: z.enum(SLOTS).optional(), myinRunId: z.string().uuid().optional(), requestedAt: z.string(),
  lease: z.object({ token: z.string().uuid(), expiresAt: z.string() }).optional(), claimedAt: z.string().optional(),
  model: z.string().optional(), issues: z.array(z.string()).optional(), failReason: z.string().optional(), doneAt: z.string().optional(),
  // 기획안 · 다시 뽑기: the market search behind the formulas, frozen when the job was asked for (like a 틈새 job's pool).
  market: z.custom<PackagingMarket>(value => Boolean(value && typeof value === "object")).optional(),
  // GPT 초안 (2026-10-29): the OS itself does the card with the company's GPT credit; no staff AI may take it.
  executor: z.literal("gpt").optional(), tier: z.enum(["precise", "saving"]).optional(),
}).passthrough();
type JobMeta = z.infer<typeof jobMetaSchema>;

export const staffJobRequestSchema = z.discriminatedUnion("task", [
  z.object({ task: z.literal("scene-plan"), sourceId: z.string().uuid(), inputKey: z.string().length(64) }).strict(),
  // attachments = 원고 공정 정본 §2 "카드 첨부": what the staff member hands the AI with the job (댓글 원문, 직접 고른 재료).
  z.object({ task: z.literal("script"), sourceId: z.string().uuid(), targetMinutes: z.number().int().min(1).max(60).default(10),
    role: z.enum(SCRIPT_ROLES).default("유입형"), attachments: z.string().trim().max(20_000).optional() }).strict(),
  // 마이인 v13 ③ 기획표 after the render PC's transcription; a resend after Logan asked for changes carries his note.
  z.object({ task: z.literal("storyboard"), sourceId: z.string().uuid() }).strict(),
  // ⑦ 유튜브 관리 발행키트, from the script approved at gate 2 (and the v13 final's subtitles for the chapters).
  z.object({ task: z.literal("kit"), sourceId: z.string().uuid() }).strict(),
  // 유튜브 공정 v1 기획안, before the 기획안 컨펌; query = the 기획실 레퍼런스 검색어 (default: the project's name).
  z.object({ task: z.literal("plan"), sourceId: z.string().uuid(), query: z.string().trim().max(60).optional() }).strict(),
  // 유튜브 공정 v1 쇼츠: clips proposed from the final's subtitles.
  z.object({ task: z.literal("shorts"), sourceId: z.string().uuid(), count: z.number().int().min(1).max(12).default(5) }).strict(),
  // 유튜브 공정 v1 숏폼: 구매 이유 (광고) and the scenes, from the topic and what to make.
  z.object({ task: z.literal("short"), sourceId: z.string().uuid() }).strict(),
  // 주제 찾기 › 틈새: 터진 영상 grouped by title formula; the source is the shared board.
  z.object({ task: z.literal("niche"), sourceId: z.string().uuid() }).strict(),
  // 유튜브 공정 v1 SEO 칼럼: the final 원고 rewritten as the 정본's HTML column.
  z.object({ task: z.literal("column"), sourceId: z.string().uuid(), count: z.number().int().min(1).max(5).default(1) }).strict(),
  // 유튜브 공정 v1 숏폼 내보내기: the YouTube title and description from the final scenes.
  z.object({ task: z.literal("short-copy"), sourceId: z.string().uuid() }).strict(),
  // 유튜브 공정 v1 최종 썸네일: one slot's title and thumbnail copy again, from the 패키징 정본 formula; reason = why the PD wants another.
  z.object({ task: z.literal("retitle"), sourceId: z.string().uuid(), slot: z.enum(SLOTS), reason: z.string().trim().max(300).default(""), query: z.string().trim().max(60).optional() }).strict(),
  // 숏폼 대본 정본 입구 A (2026-10-28): 숏폼 주제 후보 from a longform's 원고; then a 숏폼's 대본 from the shorts found by query.
  z.object({ task: z.literal("short-topics"), sourceId: z.string().uuid(), count: z.number().int().min(1).max(5).default(3) }).strict(),
  // 숏폼 주제 (owner 2026-10-28): the references' formulas and three 주제 후보 come before the topic is fixed.
  z.object({ task: z.literal("short-formula"), sourceId: z.string().uuid() }).strict(),
  z.object({ task: z.literal("short-script"), sourceId: z.string().uuid() }).strict(),
]);
export const staffJobWorkerSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim"), jobId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("complete"), jobId: z.string().uuid(), lease: z.string().uuid(), model: z.string().trim().min(1).max(100),
    result: z.record(z.unknown()) }).strict(),
  z.object({ action: z.literal("fail"), jobId: z.string().uuid(), lease: z.string().uuid(), reason: z.string().trim().min(1).max(1000) }).strict(),
]);

const service = () => createServiceSupabase();
const dbError = () => new ApiError(503, "STAFF_AI_JOB_UNAVAILABLE", "AI 작업을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
const meta = (job: OsRecord) => jobMetaSchema.parse(job.metadata) as JobMeta;
/** A 틈새 job carries the videos it was asked to group, frozen when it was requested. */
const jobPool = (m: JobMeta) => (m.pool ?? []) as NicheVideo[];
const leaseLive = (value?: JobMeta["lease"]) => Boolean(value && Date.parse(value.expiresAt) > Date.now());

/** What the 영상 제작 screen shows for a job: never the lease token. */
export function publicStaffJob(job: OsRecord) {
  const m = meta(job);
  return { id: job.id, status: job.status, task: m.task, inputKey: m.inputKey, requestedAt: m.requestedAt, claimedAt: m.claimedAt ?? null,
    model: m.model ?? null, issues: m.issues ?? [], failReason: m.failReason ?? null, doneAt: m.doneAt ?? null, processing: job.status === "active" && leaseLive(m.lease),
    targetMinutes: m.targetMinutes ?? null, role: m.role ?? null, slot: m.slot ?? null, executor: m.executor ?? "staff" };
}

async function saveJob(job: OsRecord, changes: { status?: string; stage?: string; metadata: JobMeta }) {
  const { data, error } = await service().from("os_records").update({ ...changes, updated_by: job.owner_id })
    .eq("id", job.id).eq("version", job.version).eq("record_type", "ai_job").is("archived_at", null).select("*").maybeSingle();
  if (error) throw dbError();
  if (!data) throw new ApiError(409, "STAFF_AI_JOB_CHANGED", "다른 곳에서 이 작업을 먼저 바꿨어요. 목록을 다시 확인해 주세요.");
  return data as OsRecord;
}

async function openJobs(ownerId: string, sourceId?: string, task?: JobMeta["task"]) {
  let query = service().from("os_records").select("*").eq("record_type", "ai_job").eq("metadata->>kind", STAFF_AI_JOB_KIND)
    .eq("owner_id", ownerId).in("status", ["backlog", "active"]).is("archived_at", null).order("created_at", { ascending: true }).limit(50);
  if (sourceId) query = query.eq("parent_id", sourceId);
  if (task) query = query.eq("metadata->>task", task);
  const { data, error } = await query;
  if (error) throw dbError();
  return (data ?? []) as OsRecord[];
}

/**
 * [내 AI에 보내기] on ② 원고, ③ 영상 제작 or ⑦ 유튜브 관리. Any member may ask (owner decision 2026-10-20); the job is theirs and their
 * own AI takes it. An open job of the same kind for the same input is reused,
 * and one for older input is cancelled. The job is named after the adopted title so it reads the same as the screen.
 */
export async function requestStaffJob(actor: RequestActor, input: z.infer<typeof staffJobRequestSchema>, gpt?: { tier: GptTier }) {
  let source: OsRecord; let title: string; let inputKey: string;
  let myinRunId: string | undefined;
  let taskName: string = TASK_NAME[input.task];
  let note = "";
  let pool: NicheVideo[] | undefined;
  let marketFor: { query: string; short: boolean } | undefined;
  if (input.task === "niche") {
    if (input.sourceId !== NICHE_BOARD_ID) throw new ApiError(404, "NICHE_BOARD_NOT_FOUND", "틈새 판을 찾지 못했어요.");
    pool = await nichePool(service());
    if (pool.length < 3) throw new ApiError(409, "NICHE_POOL_TOO_SMALL", "터진 영상이 3개 이상 모이면 묶을 수 있어요. 먼저 터진 영상을 찾아 주세요.");
    source = await nicheBoardRecord(service(), actor); title = "주제 찾기 · 틈새"; inputKey = nicheInputKey(pool);
  } else if (input.task === "storyboard") {
    const myin = await myinRunWithWords(service(), input.sourceId);
    if (myin.record.stage !== "words_ready") throw new ApiError(409, "MYIN_NOT_READY_FOR_STORYBOARD", "받아쓰기가 끝났고 확인 중인 기획표가 없을 때 보낼 수 있습니다.");
    note = myin.run.review?.decision === "revise" ? myin.run.review.note : "";
    const state = await readPipeline(actor, input.sourceId);
    source = state.source; title = jobTitle(state); myinRunId = myin.record.id;
    if (myin.run.layout === "short") taskName = "숏폼 기획표(세로 큰 글자 · 도식)";
    inputKey = myinStoryboardInputKey(myin.record.id, myin.run.words!.at, note);
  } else if (input.task === "plan") {
    const state = await readPipeline(actor, input.sourceId);
    if (!isYoutubeV1(state.source)) throw new ApiError(409, "NOT_YOUTUBE_PROJECT", "유튜브 공정 프로젝트에서만 보낼 수 있어요.");
    assertV1PlanInputs(state);
    source = state.source; title = jobTitle(state); inputKey = v1PlanInputKey(state);
    const { project } = v1Stages(state); marketFor = { query: input.query || projectName(project), short: project.yp.topic.type === "short" };
  } else if (input.task === "shorts") {
    const state = await readPipeline(actor, input.sourceId);
    if (!isYoutubeV1(state.source)) throw new ApiError(409, "NOT_YOUTUBE_PROJECT", "유튜브 공정 프로젝트에서만 보낼 수 있어요.");
    assertV1ShortsInputs(state);
    const shortsSource = await v1ShortsSource(service(), state);
    if (!shortsSource.srt) throw new ApiError(409, "SRT_REQUIRED", "자막(SRT)이 있어야 구간을 고를 수 있어요. 업로드 단계에서 SRT를 올려 주세요.");
    source = state.source; title = jobTitle(state); inputKey = v1ShortsInputKey(state, shortsSource);
  } else if (input.task === "column") {
    const state = await readPipeline(actor, input.sourceId);
    if (!isYoutubeV1(state.source)) throw new ApiError(409, "NOT_YOUTUBE_PROJECT", "유튜브 공정 프로젝트에서만 보낼 수 있어요.");
    assertV1ColumnInputs(state);
    source = state.source; title = jobTitle(state); inputKey = v1ColumnInputKey(state);
  } else if (input.task === "retitle") {
    const state = await readPipeline(actor, input.sourceId);
    if (!isYoutubeV1(state.source)) throw new ApiError(409, "NOT_YOUTUBE_PROJECT", "유튜브 공정 프로젝트에서만 보낼 수 있어요.");
    assertV1RetitleInputs(state, input.slot);
    source = state.source; title = jobTitle(state); inputKey = v1RetitleInputKey(state, input.slot, input.reason);
    const { project } = v1Stages(state); marketFor = { query: input.query || projectName(project), short: project.yp.topic.type === "short" };
  } else if (input.task === "short") {
    const state = await readPipeline(actor, input.sourceId);
    if (!isYoutubeV1(state.source)) throw new ApiError(409, "NOT_YOUTUBE_PROJECT", "유튜브 공정 프로젝트에서만 보낼 수 있어요.");
    const { project } = v1Stages(state);
    assertShortJobOpen(project);
    source = state.source; title = jobTitle(state); inputKey = shortJobInputKey(project, (await shortJobInputs(service(), project)).brief);
  } else if (input.task === "short-copy") {
    const state = await readPipeline(actor, input.sourceId);
    if (!isYoutubeV1(state.source)) throw new ApiError(409, "NOT_YOUTUBE_PROJECT", "유튜브 공정 프로젝트에서만 보낼 수 있어요.");
    const { project, upload } = v1Stages(state);
    assertShortCopyOpen(project, upload.data);
    const { brief, scenes } = await shortJobInputs(service(), project);
    source = state.source; title = jobTitle(state); inputKey = shortCopyInputKey(project, brief, scenes);
  } else if (input.task === "short-topics") {
    const state = await readPipeline(actor, input.sourceId);
    if (!isYoutubeV1(state.source)) throw new ApiError(409, "NOT_YOUTUBE_PROJECT", "유튜브 공정 프로젝트에서만 보낼 수 있어요.");
    assertShortTopicsInputs(state);
    source = state.source; title = jobTitle(state); inputKey = shortTopicsInputKey(state);
  } else if (input.task === "short-formula") {
    const state = await readPipeline(actor, input.sourceId);
    if (!isYoutubeV1(state.source)) throw new ApiError(409, "NOT_YOUTUBE_PROJECT", "유튜브 공정 프로젝트에서만 보낼 수 있어요.");
    assertShortFormulaInputs(state);
    source = state.source; title = jobTitle(state); inputKey = shortFormulaInputKey(state);
    if (!(await doneShortRefs(service(), state.source.id, 60))) marketFor = { query: shortScriptQuery(state), short: true };
  } else if (input.task === "short-script") {
    const state = await readPipeline(actor, input.sourceId);
    if (!isYoutubeV1(state.source)) throw new ApiError(409, "NOT_YOUTUBE_PROJECT", "유튜브 공정 프로젝트에서만 보낼 수 있어요.");
    assertShortScriptInputs(state);
    source = state.source; title = jobTitle(state); inputKey = shortScriptInputKey(state);
    // References the render PC already fetched replace the title-only search (and its YouTube quota).
    if (!(await doneShortRefs(service(), state.source.id, 60))) marketFor = { query: shortScriptQuery(state), short: true };
  } else if (input.task === "kit") {
    const state = await readPipeline(actor, input.sourceId);
    assertKitInputs(state);
    source = state.source; title = jobTitle(state); inputKey = kitInputKey(state);
  } else if (input.task === "scene-plan") {
    const { state, plan, scriptText, title: adopted } = await readYoutubeAutomationInput(actor.supabase, input.sourceId);
    if (!plan.inputKey || plan.inputKey !== input.inputKey || !scriptText) throw new ApiError(409, "AUTOMATION_INPUT_CHANGED", "원고나 승인 상태가 변경됐습니다. 새로 불러와 주세요.");
    source = state.source; title = adopted; inputKey = input.inputKey;
  } else {
    const state = await readPipeline(actor, input.sourceId);
    assertScriptInputs(state);
    source = state.source; title = jobTitle(state); inputKey = scriptInputKey(state);
  }
  // targetMinutes also carries how many 쇼츠 대본 or 칼럼 the PD asked for.
  const targetMinutes = input.task === "script" ? input.targetMinutes : input.task === "shorts" || input.task === "column" || input.task === "short-topics" ? input.count : undefined;
  const attachments = input.task === "script" ? input.attachments || undefined : input.task === "retitle" ? input.reason || undefined : undefined;
  const slot = input.task === "retitle" ? input.slot : undefined;
  const role = input.task === "script" ? input.role : undefined;
  for (const job of await openJobs(actor.id, input.sourceId, input.task)) {
    const m = meta(job);
    const sameDoer = Boolean(m.executor) === Boolean(gpt);
    if (!sameDoer && job.status === "active" && leaseLive(m.lease))
      throw new ApiError(409, "STAFF_AI_JOB_BUSY", m.executor ? "GPT가 만드는 중이에요. 끝난 뒤에 다시 해 주세요." : "내 AI가 쓰는 중이에요. 끝난 뒤에 다시 해 주세요.");
    if (sameDoer && m.inputKey === inputKey && m.targetMinutes === targetMinutes && m.role === role && m.attachments === attachments && m.slot === slot && m.market?.query === marketFor?.query) return publicStaffJob(job);
    await saveJob(job, { status: "cancelled", metadata: { ...meta(job), failReason: "입력이 바뀌어 새 요청으로 바꿨어요." } });
  }
  const now = new Date().toISOString();
  // ponytail: one search (~102 units) per new job; cache by query like the 주제 찾기 search if the daily quota gets tight.
  const market: PackagingMarket | undefined = marketFor ? await packagingReferences(marketFor.query, marketFor.short)
    .then(refs => ({ query: marketFor!.query, at: now, refs: packagingPick(refs, marketFor!.short).filter(ref => !marketFor!.short || refMatchesQuery(marketFor!.query, ref.title)) }))
    .catch((error: unknown) => ({ query: marketFor!.query, at: now, refs: [], error: error instanceof ApiError ? error.message : "유튜브 검색을 하지 못했어요." })) : undefined;
  const metadata: JobMeta = { kind: STAFF_AI_JOB_KIND, task: input.task, sourceId: input.sourceId, inputKey, requestedAt: now, ...(market ? { market } : {}),
    ...(input.task === "scene-plan" ? { templateVersion: YOUTUBE_VISUAL_TEMPLATE_VERSION } : input.task === "storyboard" ? { myinRunId }
      : { targetMinutes, role, ...(attachments ? { attachments } : {}), ...(slot ? { slot } : {}) }), ...(pool ? { pool } : {}),
    ...(gpt ? { executor: "gpt" as const, tier: gpt.tier } : {}) };
  const { data, error } = await actor.supabase.from("os_records").insert({
    id: randomUUID(), record_type: "ai_job", title: `${title} · ${taskName}`.slice(0, 240),
    description: gpt ? "OS가 회사 GPT 크레딧으로 바로 처리하는 작업입니다." : "요청한 직원의 AI가 OS 연결로 가져가 처리하는 작업입니다.", status: "backlog", stage: "queued", priority: "normal",
    brand: source.brand, team: source.team, owner_id: actor.id, parent_id: input.sourceId, created_by: actor.id, updated_by: actor.id,
    tags: ["유튜브", gpt ? "GPT" : "직원AI"], metadata,
  }).select("*").maybeSingle();
  if (error || !data) throw new ApiError(400, "STAFF_AI_JOB_CREATE_FAILED", "AI 작업을 만들지 못했습니다.");
  return publicStaffJob(data as OsRecord);
}

/** The latest job for one video, and whether the requester's AI has used its key lately (화면 칩 '내 AI'). */
export async function staffJobStatus(actor: RequestActor, sourceId: string, task: JobMeta["task"]) {
  const [{ data: jobs, error }, { data: keys, error: keyError }] = await Promise.all([
    service().from("os_records").select("*").eq("record_type", "ai_job").eq("metadata->>kind", STAFF_AI_JOB_KIND).eq("parent_id", sourceId)
      .eq("metadata->>task", task).eq("owner_id", actor.id).is("archived_at", null).order("created_at", { ascending: false }).limit(1),
    service().from("os_agent_keys").select("last_used_at").eq("owner_user_id", actor.id).eq("active", true),
  ]);
  if (error || keyError) throw dbError();
  const lastUsedAt = (keys ?? []).map(key => key.last_used_at as string | null).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  return { job: jobs?.[0] ? publicStaffJob(jobs[0] as OsRecord) : null, myAi: { keys: keys?.length ?? 0, lastUsedAt } };
}

// ── The staff AI side (agent key) ──

export async function listStaffJobs(agent: RequestActor) {
  const jobs = (await openJobs(agent.ownerId)).filter(job => !meta(job).executor && (job.status === "backlog" || !leaseLive(meta(job).lease)));
  return { jobs: jobs.map(job => ({ jobId: job.id, task: meta(job).task, title: job.title, requestedAt: meta(job).requestedAt })),
    next: jobs.length ? "process_youtube_ai_job로 action=claim, job_id를 보내 가져가세요." : "지금 처리할 작업이 없어요." };
}

async function ownJob(agent: RequestActor, jobId: string) {
  const { data, error } = await service().from("os_records").select("*").eq("id", jobId).eq("record_type", "ai_job")
    .eq("metadata->>kind", STAFF_AI_JOB_KIND).eq("owner_id", agent.ownerId).is("archived_at", null).maybeSingle();
  if (error) throw dbError();
  if (!data) throw new ApiError(404, "STAFF_AI_JOB_NOT_FOUND", "이 키 주인의 작업을 찾지 못했습니다.");
  return data as OsRecord;
}

async function closeStale(job: OsRecord, m: JobMeta): Promise<never> {
  const where = m.task === "script" ? "② 원고" : m.task === "kit" ? "⑦ 유튜브 관리" : m.task === "plan" ? "기획안" : m.task === "shorts" ? "쇼츠" : m.task === "column" ? "쇼츠 · 칼럼 › SEO 칼럼" : m.task === "short" ? "숏폼 제작" : m.task === "short-copy" ? "숏폼 내보내기" : m.task === "retitle" ? "제작 › 최종 썸네일" : m.task === "short-topics" ? "쇼츠 · 칼럼 › 숏폼 주제" : m.task === "short-formula" ? "숏폼 주제" : m.task === "short-script" ? "숏폼 대본" : "③ 영상 제작";
  await saveJob(job, { status: "blocked", metadata: { ...m, lease: undefined, failReason: `기획·제목·원고·영상 기준이 바뀌어 이 요청은 닫았어요. ${where} 화면에서 다시 보내 주세요.` } });
  throw new ApiError(409, "STAFF_AI_JOB_STALE", "입력이 바뀌어 이 작업은 닫혔습니다. 다른 작업을 확인하세요.");
}

/** The current script and approvals; a job whose input moved on is closed instead of producing a stale design. */
async function currentInput(job: OsRecord) {
  const m = meta(job);
  const automation = await readYoutubeAutomationInput(service(), m.sourceId);
  if (automation.plan.inputKey !== m.inputKey || !automation.scriptText || m.templateVersion !== YOUTUBE_VISUAL_TEMPLATE_VERSION) await closeStale(job, m);
  return { automation, segments: splitFishNarration(automation.scriptText!) };
}

/** The v13 run and its frozen transcription for a storyboard job; closed when the run moved on (new voice, or a storyboard already in review). */
async function currentStoryboardInput(job: OsRecord) {
  const m = meta(job);
  const myin = await myinRunWithWords(service(), m.sourceId).catch(() => null);
  const note = myin?.run.review?.decision === "revise" ? myin.run.review.note : "";
  if (!myin || myin.record.id !== m.myinRunId || myin.record.stage !== "words_ready" || myinStoryboardInputKey(myin.record.id, myin.run.words!.at, note) !== m.inputKey) return closeStale(job, m);
  return myin;
}

/** A v1 기획안 job: closed when the project left 기획안 or its topic changed. */
async function currentPlanInput(job: OsRecord) {
  const m = meta(job);
  const state = await readPipeline({ supabase: service() }, m.sourceId);
  try { assertV1PlanInputs(state); } catch { await closeStale(job, m); }
  if (v1PlanInputKey(state) !== m.inputKey) await closeStale(job, m);
  return state;
}

/** A v1 쇼츠 job: closed when the project or its subtitles moved on. */
async function currentShortsInput(job: OsRecord) {
  const m = meta(job);
  const state = await readPipeline({ supabase: service() }, m.sourceId);
  try { assertV1ShortsInputs(state); } catch { await closeStale(job, m); }
  if (v1ShortsInputKey(state, await v1ShortsSource(service(), state)) !== m.inputKey) await closeStale(job, m);
  return state;
}

/** A 숏폼 주제 후보 job: closed when the longform's 원고 moved on; a 숏폼 대본 job when its topic, search or references did. */
async function currentShortTopicsInput(job: OsRecord) {
  const m = meta(job);
  const state = await readPipeline({ supabase: service() }, m.sourceId);
  try { assertShortTopicsInputs(state); } catch { await closeStale(job, m); }
  if (shortTopicsInputKey(state) !== m.inputKey) await closeStale(job, m);
  return state;
}
async function currentShortFormulaInput(job: OsRecord) {
  const m = meta(job);
  const state = await readPipeline({ supabase: service() }, m.sourceId);
  try { assertShortFormulaInputs(state); } catch { await closeStale(job, m); }
  if (shortFormulaInputKey(state) !== m.inputKey) await closeStale(job, m);
  return state;
}
async function currentShortScriptInput(job: OsRecord) {
  const m = meta(job);
  const state = await readPipeline({ supabase: service() }, m.sourceId);
  try { assertShortScriptInputs(state); } catch { await closeStale(job, m); }
  if (shortScriptInputKey(state) !== m.inputKey) await closeStale(job, m);
  return state;
}

/** A v1 SEO 칼럼 job: closed when the 원고, the title or the uploaded video moved on. */
async function currentColumnInput(job: OsRecord) {
  const m = meta(job);
  const state = await readPipeline({ supabase: service() }, m.sourceId);
  try { assertV1ColumnInputs(state); } catch { await closeStale(job, m); }
  if (v1ColumnInputKey(state) !== m.inputKey) await closeStale(job, m);
  return state;
}

/** A v1 다시 뽑기 job: closed when the project left 제작 · 최종 검수. */
async function currentRetitleInput(job: OsRecord) {
  const m = meta(job);
  const state = await readPipeline({ supabase: service() }, m.sourceId);
  try { assertV1RetitleInputs(state, m.slot ?? "A"); } catch { await closeStale(job, m); }
  return state;
}

/** A v1 숏폼 제목 · 설명 job: closed when the 숏폼 went up, left 내보내기, or its scenes changed. */
async function currentShortCopyInput(job: OsRecord) {
  const m = meta(job);
  const state = await readPipeline({ supabase: service() }, m.sourceId);
  const { project, upload } = v1Stages(state);
  try { assertShortCopyOpen(project, upload.data); } catch { await closeStale(job, m); }
  const { brief, scenes } = await shortJobInputs(service(), project);
  if (shortCopyInputKey(project, brief, scenes) !== m.inputKey) await closeStale(job, m);
  return { state, project, brief, scenes };
}

/** A v1 숏폼 job: closed when the project left 제작 or what to make changed. */
async function currentShortInput(job: OsRecord) {
  const m = meta(job);
  const state = await readPipeline({ supabase: service() }, m.sourceId);
  const { project } = v1Stages(state);
  try { assertShortJobOpen(project); } catch { await closeStale(job, m); }
  const { brief } = await shortJobInputs(service(), project);
  if (shortJobInputKey(project, brief) !== m.inputKey) await closeStale(job, m);
  return { project, brief };
}

/** The approvals behind a ⑦ kit job; closed the same way when they moved on. */
async function currentKitInput(job: OsRecord) {
  const m = meta(job);
  const state = await readPipeline({ supabase: service() }, m.sourceId);
  try { assertKitInputs(state); } catch { await closeStale(job, m); }
  if (kitInputKey(state) !== m.inputKey) await closeStale(job, m);
  return state;
}

/** The approved plan and adopted title for a ② job; closed the same way when they moved on. */
async function currentScriptInput(job: OsRecord) {
  const m = meta(job);
  const state = await readPipeline({ supabase: service() }, m.sourceId);
  try { assertScriptInputs(state); } catch { await closeStale(job, m); }
  if (scriptInputKey(state) !== m.inputKey) await closeStale(job, m);
  return state;
}

/** title → doc_id for the storyboard card's documents; a missing or doubled title just goes without an id. */
async function myinCardDocIds(docs = MYIN_CARD_DOCS) {
  const { data } = await createServiceSupabase().from("os_documents").select("id,title").in("title", docs.map(([title]) => title)).neq("status", "archived");
  const rows = data ?? [];
  return Object.fromEntries(rows.filter(row => rows.filter(other => other.title === row.title).length === 1).map(row => [row.title as string, row.id as string]));
}

export async function claimStaffJob(agent: RequestActor, jobId: string, byGpt = false) {
  const job = await ownJob(agent, jobId);
  const m = meta(job);
  if (Boolean(m.executor) !== byGpt) throw new ApiError(409, "STAFF_AI_JOB_TAKEN", m.executor ? "GPT가 만드는 작업이에요." : "직원 AI에게 보낸 작업이에요.");
  if (job.status !== "backlog" && !(job.status === "active" && !leaseLive(m.lease))) throw new ApiError(409, "STAFF_AI_JOB_TAKEN", "이미 처리 중이거나 끝난 작업입니다.");
  const minutes = LEASE_MINUTES[m.task];
  const take = async () => {
    const lease = { token: randomUUID(), expiresAt: new Date(Date.now() + minutes * 60_000).toISOString() };
    await saveJob(job, { status: "active", stage: "claimed", metadata: { ...m, lease, claimedAt: new Date().toISOString(), issues: [] } });
    return lease;
  };
  if (m.task === "storyboard") {
    const myin = await currentStoryboardInput(job);
    const lease = await take();
    const note = myin.run.review?.decision === "revise" ? myin.run.review.note : undefined;
    if (myin.run.layout === "short") return { jobId, task: m.task, lease: lease.token, leaseExpiresAt: lease.expiresAt,
      instructions: shortStoryboardCard({ title: myin.title, headCopy: myin.headCopy, screenScript: myin.screenScript, markdown: myin.markdown, words: myin.words,
        durationSeconds: myin.run.words!.durationSeconds, note, leaseMinutes: minutes, diagrams: DIAGRAM_CATALOG, docIds: await myinCardDocIds(SHORT_CARD_DOCS) }) };
    return { jobId, task: m.task, lease: lease.token, leaseExpiresAt: lease.expiresAt,
      instructions: myinStoryboardCard({ title: myin.title, markdown: myin.markdown, words: myin.words, durationSeconds: myin.run.words!.durationSeconds,
        note: myin.run.review?.decision === "revise" ? myin.run.review.note : undefined, leaseMinutes: minutes, catalog: await readDiagramCatalog(), docIds: await myinCardDocIds() }) };
  }
  if (m.task === "niche") {
    const lease = await take();
    return { jobId, task: m.task, lease: lease.token, leaseExpiresAt: lease.expiresAt, instructions: nicheJobCard(jobPool(m), minutes) };
  }
  if (m.task === "shorts") {
    const state = await currentShortsInput(job);
    const lease = await take();
    return { jobId, task: m.task, lease: lease.token, leaseExpiresAt: lease.expiresAt, instructions: await v1ShortsCard(service(), state, minutes, m.targetMinutes ?? 5) };
  }
  if (m.task === "short-topics") {
    const state = await currentShortTopicsInput(job);
    const lease = await take();
    return { jobId, task: m.task, lease: lease.token, leaseExpiresAt: lease.expiresAt, instructions: await shortTopicsCard(service(), state, minutes, m.targetMinutes ?? 3) };
  }
  if (m.task === "short-formula") {
    const state = await currentShortFormulaInput(job);
    const lease = await take();
    return { jobId, task: m.task, lease: lease.token, leaseExpiresAt: lease.expiresAt, instructions: await shortFormulaCard(service(), state, minutes, m.market) };
  }
  if (m.task === "short-script") {
    const state = await currentShortScriptInput(job);
    const lease = await take();
    return { jobId, task: m.task, lease: lease.token, leaseExpiresAt: lease.expiresAt, instructions: await shortScriptCard(service(), state, minutes, m.market) };
  }
  if (m.task === "column") {
    const state = await currentColumnInput(job);
    const lease = await take();
    return { jobId, task: m.task, lease: lease.token, leaseExpiresAt: lease.expiresAt, instructions: await v1ColumnCard(service(), state, minutes, m.targetMinutes ?? 1) };
  }
  if (m.task === "short-copy") {
    const { project, brief, scenes } = await currentShortCopyInput(job);
    const lease = await take();
    const docs = withNamed(await namedProcedures(service(), [SHORTFORM_CANON_TITLE]), await procedureRefs(service(), "shorts_proposal").catch(() => []), 4);
    return { jobId, task: m.task, lease: lease.token, leaseExpiresAt: lease.expiresAt, instructions: shortCopyCard(project, brief, scenes, docs, minutes) };
  }
  if (m.task === "short") {
    const { project, brief } = await currentShortInput(job);
    const lease = await take();
    const lists = await Promise.all((brief.purpose === "ad" ? ["shorts_proposal", "appeal_candidates"] as const : ["shorts_proposal"] as const).map(action => procedureRefs(service(), action).catch(() => [])));
    const docs = withNamed(await namedProcedures(service(), [SHORTFORM_CANON_TITLE]), lists.flat(), 8);
    return { jobId, task: m.task, lease: lease.token, leaseExpiresAt: lease.expiresAt, instructions: shortJobCard(project, brief, docs, minutes) };
  }
  if (m.task === "retitle") {
    const state = await currentRetitleInput(job);
    const lease = await take();
    return { jobId, task: m.task, lease: lease.token, leaseExpiresAt: lease.expiresAt, instructions: await v1RetitleCard(service(), state, minutes, m.slot ?? "A", m.attachments ?? "", m.market) };
  }
  if (m.task === "plan") {
    const state = await currentPlanInput(job);
    const lease = await take();
    return { jobId, task: m.task, lease: lease.token, leaseExpiresAt: lease.expiresAt, instructions: await v1PlanCard(service(), state, minutes, m.market) };
  }
  if (m.task === "kit") {
    const state = await currentKitInput(job);
    const lease = await take();
    return { jobId, task: m.task, lease: lease.token, leaseExpiresAt: lease.expiresAt, instructions: await kitJobCard(service(), state, minutes) };
  }
  if (m.task === "script") {
    const state = await currentScriptInput(job);
    const lease = await take();
    return { jobId, task: m.task, lease: lease.token, leaseExpiresAt: lease.expiresAt,
      instructions: await scriptJobCard(service(), state, { targetMinutes: m.targetMinutes ?? 10, leaseMinutes: minutes, role: m.role ?? "유입형", attachments: m.attachments }) };
  }
  const { automation, segments } = await currentInput(job);
  const lease = await take();
  const scene = scenePlanPrompt({ script: automation.scriptText!, title: automation.title, thumbnailCopy: automation.thumbnailCopy,
    evidence: String(automation.state.source.metadata.evidence ?? ""), rules: await youtubeSceneRuleRefs({ supabase: service() }) }).prompt;
  return {
    jobId, task: m.task, lease: lease.token, leaseExpiresAt: lease.expiresAt,
    instructions: `이 작업 하나만 처리합니다. 승인 · 업로드 · 게시 · 삭제는 하지 않습니다. 아래 두 가지를 만들어 JSON 하나로 제출하세요.\n\n## 1. 화면 설계 (result.plan)\n${scene}\n\n## 2. 발음 검토 (result.pronunciation)\n${pronunciationPrompt(segments, true)}\n\n## 제출\nprocess_youtube_ai_job에 action=complete, job_id, lease, model(지금 쓰는 모델 이름), result={ "plan": …, "pronunciation": … }를 보내세요. 형식이 틀리면 고칠 점이 돌아오니 고쳐서 다시 complete 하세요. ${minutes}분 안에 끝내지 못하거나 처리할 수 없으면 action=fail과 reason(한 줄)을 보내세요.`,
    resultSchema: { type: "object", additionalProperties: false, properties: { plan: SCENE_PLAN_JSON_SCHEMA, pronunciation: PRONUNCIATION_JSON_SCHEMA }, required: ["plan", "pronunciation"] },
  };
}

function liveLease(job: OsRecord, token: string) {
  const m = meta(job);
  if (job.status !== "active" || m.lease?.token !== token) throw new ApiError(409, "STAFF_AI_JOB_LEASE", "이 작업을 가져간 기록이 없거나 다른 곳에서 다시 가져갔습니다. 목록부터 다시 확인하세요.");
  return m;
}

/** The job stays with this AI so it can fix and resubmit; the screen shows the same problems. */
async function keepIssues<T>(job: OsRecord, m: JobMeta, check: () => Promise<T> | T) {
  try { return await check(); } catch (error) {
    if (error instanceof ApiError && error.status === 422) await saveJob(job, { metadata: { ...m, issues: [error.message] } }).catch(() => undefined);
    throw error;
  }
}

export async function completeStaffJob(agent: RequestActor, input: Extract<z.infer<typeof staffJobWorkerSchema>, { action: "complete" }>) {
  const job = await ownJob(agent, input.jobId);
  const m = liveLease(job, input.lease);
  if (m.task === "script") return completeScriptJob(agent, job, m, input);
  if (m.task === "niche") {
    const clusters = await keepIssues(job, m, () => checkNicheResult(input.result, jobPool(m)));
    const saved = await saveNicheBoard(service(), clusters, { ownerId: agent.ownerId, name: await displayName(service(), agent.ownerId, agent.name), model: input.model });
    await saveJob(job, { status: "done", stage: "done", metadata: { ...m, lease: undefined, model: input.model, issues: [], doneAt: new Date().toISOString() } });
    return { done: true, ...saved, next: "팀이 유튜브 공정 › 주제 찾기 › 틈새에서 기획으로 넘길지 정합니다." };
  }
  if (m.task === "shorts") {
    const state = await currentShortsInput(job);
    const saved = await keepIssues(job, m, () => saveV1Shorts(service(), agent.ownerId, state, input.result, { model: input.model, jobId: job.id }, m.targetMinutes));
    await saveJob(job, { status: "done", stage: "done", metadata: { ...m, lease: undefined, model: input.model, issues: [], doneAt: new Date().toISOString() } });
    return { done: true, ...saved, next: "담당 PD가 유튜브 공정 › 쇼츠 · 칼럼에서 대본을 고르고 대표 쇼츠 컨펌을 요청합니다." };
  }
  if (m.task === "short-topics") {
    const state = await currentShortTopicsInput(job);
    const by = await displayName(service(), agent.ownerId, agent.name);
    const saved = await keepIssues(job, m, () => saveShortTopics(service(), agent.ownerId, state, input.result, { by, model: input.model, jobId: job.id }, m.targetMinutes ?? 3));
    await saveJob(job, { status: "done", stage: "done", metadata: { ...m, lease: undefined, model: input.model, issues: [], doneAt: new Date().toISOString() } });
    return { done: true, ...saved, next: "담당 PD가 유튜브 공정 › 쇼츠 · 칼럼 › 숏폼 주제에서 후보를 골라 숏폼으로 만듭니다." };
  }
  if (m.task === "short-formula") {
    const state = await currentShortFormulaInput(job);
    const by = await displayName(service(), agent.ownerId, agent.name);
    const saved = await keepIssues(job, m, () => saveShortFormula(service(), agent.ownerId, state, input.result, { by, model: input.model, jobId: job.id, team: state.source.team ?? "" }, m.market));
    await saveJob(job, { status: "done", stage: "done", metadata: { ...m, lease: undefined, model: input.model, issues: [], doneAt: new Date().toISOString() } });
    return { done: true, ...saved, next: "담당 PD가 유튜브 공정 › 주제에서 주제 후보 하나를 골라 주제를 확정합니다." };
  }
  if (m.task === "short-script") {
    const state = await currentShortScriptInput(job);
    const by = await displayName(service(), agent.ownerId, agent.name);
    const saved = await keepIssues(job, m, () => saveShortScript(service(), agent.ownerId, state, input.result, { by, model: input.model, jobId: job.id, team: state.source.team ?? "" }, m.market));
    await saveJob(job, { status: "done", stage: "done", metadata: { ...m, lease: undefined, model: input.model, issues: [], doneAt: new Date().toISOString() } });
    return { done: true, ...saved, next: "담당 PD가 유튜브 공정 › 대본에서 다듬고 대본을 확정합니다." };
  }
  if (m.task === "column") {
    const state = await currentColumnInput(job);
    const saved = await keepIssues(job, m, () => saveV1Column(service(), agent.ownerId, state, input.result, { model: input.model, jobId: job.id, name: agent.name }, m.targetMinutes ?? 1));
    await saveJob(job, { status: "done", stage: "done", metadata: { ...m, lease: undefined, model: input.model, issues: [], doneAt: new Date().toISOString() } });
    return { done: true, ...saved, next: "담당 PD가 유튜브 공정 › 쇼츠 · 칼럼에서 이미지를 넣고 칼럼 HTML을 내보냅니다." };
  }
  if (m.task === "short-copy") {
    const { state, project } = await currentShortCopyInput(job);
    const saved = await keepIssues(job, m, async () => saveShortCopy(service(), project, state.source.team ?? "", input.result,
      { userId: agent.ownerId, name: await displayName(service(), agent.ownerId, agent.name), model: input.model, jobId: job.id }));
    await saveJob(job, { status: "done", stage: "done", metadata: { ...m, lease: undefined, model: input.model, issues: [], doneAt: new Date().toISOString() } });
    return { done: true, ...saved, next: "담당자가 유튜브 공정 › 내보내기에서 제목 · 설명을 다듬고 유튜브 쇼츠로 올립니다." };
  }
  if (m.task === "short") {
    const { project, brief } = await currentShortInput(job);
    const checked = await keepIssues(job, m, () => checkShortResult(input.result, brief));
    const saved = await saveShortJob(service(), project, checked, { by: await displayName(service(), agent.ownerId, agent.name), model: input.model, at: new Date().toISOString() });
    await saveJob(job, { status: "done", stage: "done", metadata: { ...m, lease: undefined, model: input.model, issues: [], doneAt: new Date().toISOString() } });
    return { done: true, ...saved, next: "담당자가 유튜브 공정 › 제작에서 장면마다 이미지를 넣고 MP4를 만듭니다." };
  }
  if (m.task === "retitle") {
    const state = await currentRetitleInput(job);
    const saved = await keepIssues(job, m, () => saveV1Retitle(service(), agent.ownerId, state, input.result, { model: input.model, jobId: job.id, name: agent.name }, m.slot ?? "A", m.market));
    await saveJob(job, { status: "done", stage: "done", metadata: { ...m, lease: undefined, model: input.model, issues: [], doneAt: new Date().toISOString() } });
    return { done: true, ...saved, next: "담당 PD가 유튜브 공정 › 제작 › 최종 썸네일에서 후보 하나를 고르고 이유와 함께 저장합니다." };
  }
  if (m.task === "plan") {
    const state = await currentPlanInput(job);
    const saved = await keepIssues(job, m, () => saveV1Plan(service(), agent.ownerId, state, input.result, { model: input.model, jobId: job.id, name: agent.name }, m.market));
    await saveJob(job, { status: "done", stage: "done", metadata: { ...m, lease: undefined, model: input.model, issues: [], doneAt: new Date().toISOString() } });
    return { done: true, ...saved, next: "담당 PD가 유튜브 공정 › 기획안에서 다듬고 기획안 컨펌을 요청합니다." };
  }
  if (m.task === "kit") {
    const state = await currentKitInput(job);
    const saved = await keepIssues(job, m, () => saveStaffKit(service(), agent.ownerId, state, input.result, { model: input.model, jobId: job.id, name: agent.name }));
    await saveJob(job, { status: "done", stage: "done", metadata: { ...m, lease: undefined, model: input.model, issues: [], doneAt: new Date().toISOString() } });
    return { done: true, ...saved, next: "담당 직원이 ⑦ 유튜브 관리에서 문안과 업로드 체크리스트를 검수합니다." };
  }
  if (m.task === "storyboard") {
    const myin = await currentStoryboardInput(job);
    const catalogTypes = diagramCatalogTypes(await readDiagramCatalog());
    const checked = await keepIssues(job, m, () => myin.run.layout === "short"
      ? checkShortStoryboardResult(input.result, { words: myin.words, speech: myin.speech, headCopy: myin.headCopy, durationSeconds: myin.run.words!.durationSeconds, diagrams: DIAGRAM_CATALOG })
      : checkMyinStoryboardResult(input.result, myin.words, catalogTypes, myin.speech));
    await saveMyinStoryboard(service(), myin.record, myin.run, { storyboard: checked.storyboard, assets: checked.assets, reasons: checked.reasons,
      fuzzy: checked.fuzzy, notes: checked.notes, model: input.model });
    await saveJob(job, { status: "done", stage: "done", metadata: { ...m, lease: undefined, model: input.model, issues: [], doneAt: new Date().toISOString() } });
    return { done: true, scenes: (checked.storyboard.scenes as unknown[]).length, fuzzyCues: checked.fuzzy.length, next: myin.run.layout === "short" ? "로건, 유쓰가 숏폼 제작 화면에서 기획표를 확인합니다." : "로건, 유쓰가 ③ 영상 제작 화면에서 비유 포인트·구독 위치·한 장 정리를 확인합니다." };
  }
  const { automation, segments } = await currentInput(job);
  const { plan, pronunciation } = await keepIssues(job, m, () => ({
    plan: checkScenePlan(input.result.plan, segments, 422),
    pronunciation: checkPronunciation(input.result.pronunciation, segments, 422),
  }));
  const source = automation.state.source;
  const rest = { ...source.metadata };
  delete rest.narratedScenePlanDraft;
  const now = new Date().toISOString();
  const narratedScenePlan = { inputKey: m.inputKey, model: input.model, templateVersion: YOUTUBE_VISUAL_TEMPLATE_VERSION,
    plan, pronunciation, segmentCount: segments.length, generatedAt: now, judgmentMode: "advisory_only",
    author: { type: "staff_ai", ownerId: agent.ownerId, model: input.model, jobId: job.id } };
  const { data: saved, error } = await service().from("os_records").update({ metadata: { ...rest, narratedScenePlan }, updated_by: agent.ownerId })
    .eq("id", source.id).eq("version", source.version).is("archived_at", null).select("id").maybeSingle();
  if (error) throw dbError();
  if (!saved) throw new ApiError(409, "AUTOMATION_INPUT_CHANGED", "그사이 콘텐츠가 바뀌었습니다. 같은 결과로 다시 complete 해 주세요.");
  await saveJob(job, { status: "done", stage: "done", metadata: { ...m, lease: undefined, model: input.model, issues: [], doneAt: now } });
  return { done: true, scenes: segments.length, unresolved: plan.unresolved.length, pronunciationReady: pronunciation.ready };
}

async function completeScriptJob(agent: RequestActor, job: OsRecord, m: JobMeta, input: Extract<z.infer<typeof staffJobWorkerSchema>, { action: "complete" }>) {
  await currentScriptInput(job);
  const saved = await keepIssues(job, m, () => {
    const parsed = scriptBundleSchema.safeParse(input.result);
    if (!parsed.success) throw new ApiError(422, "SCRIPT_BUNDLE_INVALID", `제출 묶음 형식이 맞지 않습니다: ${parsed.error.issues.slice(0, 10).map((issue) => `${issue.path.join(".") || "result"} ${issue.message}`).join(" / ")}`);
    return saveScriptBundle({ supabase: service(), id: agent.ownerId, name: agent.name }, m.sourceId, parsed.data, { type: "staff_ai", model: input.model, jobId: job.id, targetMinutes: m.targetMinutes ?? 10 });
  });
  await saveJob(job, { status: "done", stage: "done", metadata: { ...m, lease: undefined, model: input.model, issues: [], doneAt: new Date().toISOString() } });
  return { done: true, ...saved, next: "담당 직원이 ② 원고 화면에서 읽고 확인한 뒤 대표 최종 승인으로 넘깁니다." };
}

export async function failStaffJob(agent: RequestActor, input: Extract<z.infer<typeof staffJobWorkerSchema>, { action: "fail" }>) {
  const job = await ownJob(agent, input.jobId);
  const m = liveLease(job, input.lease);
  await saveJob(job, { status: "blocked", stage: "failed", metadata: { ...m, lease: undefined, failReason: input.reason } });
  return { closed: true };
}
