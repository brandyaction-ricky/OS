import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { OsRecord } from "@/lib/record-types";
import type { RequestActor } from "./auth";
import { splitFishNarration } from "./fish-audio";
import { readYoutubeAutomationInput } from "./youtube-automation-input";
import { checkScenePlan, SCENE_PLAN_JSON_SCHEMA, scenePlanPrompt, youtubeSceneRuleRefs } from "./youtube-scenes";
import { checkPronunciation, pronunciationPrompt, PRONUNCIATION_JSON_SCHEMA } from "./youtube-voice-worker";
import { YOUTUBE_VISUAL_TEMPLATE_VERSION } from "@/lib/youtube-visual-template";

// Staff AI jobs (owner decision 2026-10-17, method B): the requester's own Claude or Codex reaches the OS through
// MCP with a personal agent key, takes a job, does the text work on its own plan and submits; the OS only checks and stores.
export const STAFF_AI_JOB_KIND = "youtube_staff_ai_v1";
const LEASE_MINUTES = 30;
const versionRef = z.object({ id: z.string(), version: z.number() });
const jobMetaSchema = z.object({
  kind: z.literal(STAFF_AI_JOB_KIND), task: z.literal("scene-plan"), sourceId: z.string().uuid(), inputKey: z.string().length(64),
  // ruleVersions only on jobs made before 2026-10-18; a design no longer depends on script rule versions.
  templateVersion: z.string(), ruleVersions: z.array(versionRef).optional(), requestedAt: z.string(),
  lease: z.object({ token: z.string().uuid(), expiresAt: z.string() }).optional(), claimedAt: z.string().optional(),
  model: z.string().optional(), issues: z.array(z.string()).optional(), failReason: z.string().optional(), doneAt: z.string().optional(),
}).passthrough();
type JobMeta = z.infer<typeof jobMetaSchema>;

export const staffJobRequestSchema = z.object({ sourceId: z.string().uuid(), inputKey: z.string().length(64), task: z.literal("scene-plan") }).strict();
export const staffJobWorkerSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim"), jobId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("complete"), jobId: z.string().uuid(), lease: z.string().uuid(), model: z.string().trim().min(1).max(100),
    result: z.object({ plan: z.unknown(), pronunciation: z.unknown() }).strict() }).strict(),
  z.object({ action: z.literal("fail"), jobId: z.string().uuid(), lease: z.string().uuid(), reason: z.string().trim().min(1).max(300) }).strict(),
]);

const service = () => createServiceSupabase();
const dbError = () => new ApiError(503, "STAFF_AI_JOB_UNAVAILABLE", "AI 작업을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
const meta = (job: OsRecord) => jobMetaSchema.parse(job.metadata) as JobMeta;
const leaseLive = (value?: JobMeta["lease"]) => Boolean(value && Date.parse(value.expiresAt) > Date.now());

/** What the 영상 제작 screen shows for a job: never the lease token. */
export function publicStaffJob(job: OsRecord) {
  const m = meta(job);
  return { id: job.id, status: job.status, task: m.task, inputKey: m.inputKey, requestedAt: m.requestedAt, claimedAt: m.claimedAt ?? null,
    model: m.model ?? null, issues: m.issues ?? [], failReason: m.failReason ?? null, doneAt: m.doneAt ?? null, processing: job.status === "active" && leaseLive(m.lease) };
}

async function saveJob(job: OsRecord, changes: { status?: string; stage?: string; metadata: JobMeta }) {
  const { data, error } = await service().from("os_records").update({ ...changes, updated_by: job.owner_id })
    .eq("id", job.id).eq("version", job.version).eq("record_type", "ai_job").is("archived_at", null).select("*").maybeSingle();
  if (error) throw dbError();
  if (!data) throw new ApiError(409, "STAFF_AI_JOB_CHANGED", "다른 곳에서 이 작업을 먼저 바꿨어요. 목록을 다시 확인해 주세요.");
  return data as OsRecord;
}

async function openJobs(ownerId: string, sourceId?: string) {
  let query = service().from("os_records").select("*").eq("record_type", "ai_job").eq("metadata->>kind", STAFF_AI_JOB_KIND)
    .eq("owner_id", ownerId).in("status", ["backlog", "active"]).is("archived_at", null).order("created_at", { ascending: true }).limit(50);
  if (sourceId) query = query.eq("parent_id", sourceId);
  const { data, error } = await query;
  if (error) throw dbError();
  return (data ?? []) as OsRecord[];
}

/** 영상 제작 › 화면 설계 › [내 AI에 보내기]. The content owner asks; an open job for the same input is reused. */
export async function requestScenePlanJob(actor: RequestActor, input: z.infer<typeof staffJobRequestSchema>) {
  const { state, plan, scriptText } = await readYoutubeAutomationInput(actor.supabase, input.sourceId);
  if (state.source.owner_id !== actor.id) throw new ApiError(403, "CONTENT_OWNER_REQUIRED", "이 콘텐츠의 소유자만 화면 설계를 요청할 수 있습니다.");
  if (!plan.inputKey || plan.inputKey !== input.inputKey || !scriptText) throw new ApiError(409, "AUTOMATION_INPUT_CHANGED", "원고나 승인 상태가 변경됐습니다. 새로 불러와 주세요.");
  for (const job of await openJobs(actor.id, input.sourceId)) {
    if (meta(job).inputKey === input.inputKey) return publicStaffJob(job);
    await saveJob(job, { status: "cancelled", metadata: { ...meta(job), failReason: "원고가 바뀌어 새 요청으로 바꿨어요." } });
  }
  const now = new Date().toISOString();
  const metadata: JobMeta = { kind: STAFF_AI_JOB_KIND, task: "scene-plan", sourceId: input.sourceId, inputKey: input.inputKey,
    templateVersion: YOUTUBE_VISUAL_TEMPLATE_VERSION, requestedAt: now };
  const { data, error } = await actor.supabase.from("os_records").insert({
    id: randomUUID(), record_type: "ai_job", title: `${state.source.title} · 화면 설계와 발음 검토`.slice(0, 240),
    description: "요청한 직원의 AI가 OS 연결로 가져가 처리하는 작업입니다.", status: "backlog", stage: "queued", priority: "normal",
    brand: state.source.brand, team: state.source.team, owner_id: actor.id, parent_id: input.sourceId, created_by: actor.id, updated_by: actor.id,
    tags: ["유튜브", "직원AI"], metadata,
  }).select("*").maybeSingle();
  if (error || !data) throw new ApiError(400, "STAFF_AI_JOB_CREATE_FAILED", "AI 작업을 만들지 못했습니다.");
  return publicStaffJob(data as OsRecord);
}

/** The latest job for one video, and whether the requester's AI has used its key lately (화면 칩 '내 AI'). */
export async function staffJobStatus(actor: RequestActor, sourceId: string) {
  const [{ data: jobs, error }, { data: keys, error: keyError }] = await Promise.all([
    service().from("os_records").select("*").eq("record_type", "ai_job").eq("metadata->>kind", STAFF_AI_JOB_KIND).eq("parent_id", sourceId)
      .eq("owner_id", actor.id).is("archived_at", null).order("created_at", { ascending: false }).limit(1),
    service().from("os_agent_keys").select("last_used_at").eq("owner_user_id", actor.id).eq("active", true),
  ]);
  if (error || keyError) throw dbError();
  const lastUsedAt = (keys ?? []).map(key => key.last_used_at as string | null).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  return { job: jobs?.[0] ? publicStaffJob(jobs[0] as OsRecord) : null, myAi: { keys: keys?.length ?? 0, lastUsedAt } };
}

// ── The staff AI side (agent key) ──

export async function listStaffJobs(agent: RequestActor) {
  const jobs = (await openJobs(agent.ownerId)).filter(job => job.status === "backlog" || !leaseLive(meta(job).lease));
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

/** The current script and approvals; a job whose input moved on is closed instead of producing a stale design. */
async function currentInput(job: OsRecord) {
  const m = meta(job);
  const automation = await readYoutubeAutomationInput(service(), m.sourceId);
  const stale = automation.plan.inputKey !== m.inputKey || !automation.scriptText || m.templateVersion !== YOUTUBE_VISUAL_TEMPLATE_VERSION;
  if (stale) {
    await saveJob(job, { status: "blocked", metadata: { ...m, lease: undefined, failReason: "원고·승인·영상 기준이 바뀌어 이 요청은 닫았어요. 영상 제작 화면에서 다시 보내 주세요." } });
    throw new ApiError(409, "STAFF_AI_JOB_STALE", "원고나 영상 기준이 바뀌어 이 작업은 닫혔습니다. 다른 작업을 확인하세요.");
  }
  return { automation, segments: splitFishNarration(automation.scriptText!) };
}

export async function claimStaffJob(agent: RequestActor, jobId: string) {
  const job = await ownJob(agent, jobId);
  const m = meta(job);
  if (job.status !== "backlog" && !(job.status === "active" && !leaseLive(m.lease))) throw new ApiError(409, "STAFF_AI_JOB_TAKEN", "이미 처리 중이거나 끝난 작업입니다.");
  const { automation, segments } = await currentInput(job);
  const lease = { token: randomUUID(), expiresAt: new Date(Date.now() + LEASE_MINUTES * 60_000).toISOString() };
  await saveJob(job, { status: "active", stage: "claimed", metadata: { ...m, lease, claimedAt: new Date().toISOString(), issues: [] } });
  const scene = scenePlanPrompt({ script: automation.scriptText!, title: automation.title, thumbnailCopy: automation.thumbnailCopy,
    evidence: String(automation.state.source.metadata.evidence ?? ""), rules: await youtubeSceneRuleRefs({ supabase: service() }) }).prompt;
  return {
    jobId, lease: lease.token, leaseExpiresAt: lease.expiresAt,
    instructions: `이 작업 하나만 처리합니다. 승인 · 업로드 · 게시 · 삭제는 하지 않습니다. 아래 두 가지를 만들어 JSON 하나로 제출하세요.\n\n## 1. 화면 설계 (result.plan)\n${scene}\n\n## 2. 발음 검토 (result.pronunciation)\n${pronunciationPrompt(segments, true)}\n\n## 제출\nprocess_youtube_ai_job에 action=complete, job_id, lease, model(지금 쓰는 모델 이름), result={ "plan": …, "pronunciation": … }를 보내세요. 형식이 틀리면 고칠 점이 돌아오니 고쳐서 다시 complete 하세요. ${LEASE_MINUTES}분 안에 끝내지 못하거나 처리할 수 없으면 action=fail과 reason(한 줄)을 보내세요.`,
    resultSchema: { type: "object", additionalProperties: false, properties: { plan: SCENE_PLAN_JSON_SCHEMA, pronunciation: PRONUNCIATION_JSON_SCHEMA }, required: ["plan", "pronunciation"] },
  };
}

function liveLease(job: OsRecord, token: string) {
  const m = meta(job);
  if (job.status !== "active" || m.lease?.token !== token) throw new ApiError(409, "STAFF_AI_JOB_LEASE", "이 작업을 가져간 기록이 없거나 다른 곳에서 다시 가져갔습니다. 목록부터 다시 확인하세요.");
  return m;
}

export async function completeStaffJob(agent: RequestActor, input: Extract<z.infer<typeof staffJobWorkerSchema>, { action: "complete" }>) {
  const job = await ownJob(agent, input.jobId);
  const m = liveLease(job, input.lease);
  const { automation, segments } = await currentInput(job);
  let plan; let pronunciation;
  try {
    plan = checkScenePlan(input.result.plan, segments, 422);
    pronunciation = checkPronunciation(input.result.pronunciation, segments, 422);
  } catch (error) {
    // The job stays with this AI so it can fix and resubmit; the screen shows the same problems.
    if (error instanceof ApiError) await saveJob(job, { metadata: { ...m, issues: [error.message] } }).catch(() => undefined);
    throw error;
  }
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

export async function failStaffJob(agent: RequestActor, input: Extract<z.infer<typeof staffJobWorkerSchema>, { action: "fail" }>) {
  const job = await ownJob(agent, input.jobId);
  const m = liveLease(job, input.lease);
  await saveJob(job, { status: "blocked", stage: "failed", metadata: { ...m, lease: undefined, failReason: input.reason } });
  return { closed: true };
}
