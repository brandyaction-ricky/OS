import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { OsRecord } from "@/lib/record-types";
import { narrationFromMarkdown } from "@/lib/youtube-narration-document";
import { editableFields } from "@/lib/youtube-process/confirm";
import { projectFromRecord, projectName, type YpGate, type YpProject } from "@/lib/youtube-process/project";
import {
  confirmPlan, draftMissing, hiddenTagsOf, outlineMissing, PLAN_FIELD_KEY, scriptFromPlan, SLOTS, stageData, STAGE_RECORD, thumbsMissing, withScriptVersion,
  type YpMake, type YpOutline, type YpPlan, type YpStageKind, type YpStages, type YpUpload,
} from "@/lib/youtube-process/stages";
import type { RequestActor } from "./auth";
import { actOnGate, confirmActionSchema, confirmYoutubeGate, conflict, gateActionSchema, getYoutubeProject, notify, readFailed, saveProject } from "./youtube-process";

// 유튜브 공정 v1 stage records (지시서 6-1): each step keeps its own child record, so a 대표 decision on the project and a PD
// edit on a step never fight over one version number.
type Supabase = RequestActor["supabase"];
export const MEDIA_BUCKET = "os-content-media";
const STAGE_TYPES = ["content_package", "content_script"];
// MYIN_RUN_KIND in myin-run.ts (not imported: myin-run reads this module through the automation input).
const MYIN_RUN_KIND = "youtube_myin_v13";

/** The four step records of a project; a step nobody saved yet reads as its empty shape (id null, version 0). */
export async function readStages(supabase: Supabase, project: YpProject): Promise<YpStages & { records: OsRecord[] }> {
  const { data, error } = await supabase.from("os_records").select("*").eq("parent_id", project.id).in("record_type", STAGE_TYPES).is("archived_at", null).order("created_at", { ascending: false }).limit(50);
  if (error) throw readFailed();
  const records = (data ?? []) as OsRecord[];
  const pick = <K extends YpStageKind>(kind: K) => {
    const spec = STAGE_RECORD[kind];
    const record = records.find(row => row.record_type === spec.recordType && row.metadata?.[spec.key] === spec.value);
    return { id: record?.id ?? null, version: record?.version ?? 0, data: stageData(kind, record?.metadata?.yp, project.yp.topic.type) };
  };
  const stages = { plan: pick("plan"), outline: pick("outline"), make: pick("make"), upload: pick("upload"), records };
  // 4-5: the first 원고 starts from the 기획안 영상 흐름.
  if (!stages.outline.id && stages.plan.data.opening) stages.outline.data = { ...stages.outline.data, script: scriptFromPlan(stages.plan.data) };
  return stages;
}

export interface YpFinal { v: number; at: string; source: "myin" | "upload"; name: string; bytes: number; durationSeconds: number | null; runId?: string; path?: string }
/** Every final in time order: the OS-made 마이인 finals (from their runs) and the files uploaded by hand. */
export async function readFinals(supabase: Supabase, projectId: string, make: YpMake): Promise<YpFinal[]> {
  const { data, error } = await supabase.from("os_records").select("id,stage,metadata").eq("parent_id", projectId).eq("record_type", "ai_job")
    .eq("metadata->>kind", MYIN_RUN_KIND).is("archived_at", null).limit(50);
  if (error) throw readFailed();
  const runs = (data ?? []).filter(row => row.stage === "final_ready" && row.metadata?.final).map(row => {
    const final = row.metadata.final as { at: string; bytes: number; durationSeconds: number };
    return { at: final.at, source: "myin" as const, name: "final_myin.mp4", bytes: final.bytes, durationSeconds: final.durationSeconds, runId: row.id as string };
  });
  const uploads = make.finals.map(item => ({ at: item.at, source: "upload" as const, name: item.name, bytes: item.bytes, durationSeconds: null, path: item.path }));
  return [...runs, ...uploads].sort((a, b) => a.at.localeCompare(b.at)).map((item, index) => ({ ...item, v: index + 1 }));
}

export async function youtubeProjectBundle(actor: RequestActor, id: string) {
  const project = await getYoutubeProject(actor, id);
  const { plan, outline, make, upload } = await readStages(actor.supabase, project);
  return { project, stages: { plan, outline, make, upload }, finals: await readFinals(actor.supabase, project.id, make.data) };
}

// ── Saving a step ──
const assetPath = (projectId: string, kind: string) => new RegExp(`^youtube/${projectId}/${kind}/[0-9a-f-]{36}\\.[a-z0-9]+$`);
const text = (max: number) => z.string().max(max);
const refSchema = z.object({ url: z.string().url().max(300), videoId: z.string().max(20).optional(), title: z.string().max(200).optional() }).strict();
const thumbSchema = z.object({ id: text(40), mode: z.enum(["img", "text"]), path: text(300).optional(), screen: text(500).optional(), copy: text(120).optional() }).strict();
export const stagePatchSchemas = {
  plan: z.object({ titles: z.array(z.object({ id: text(40), text: text(200) }).strict()).min(1).max(12), thumbs: z.array(thumbSchema).min(1).max(8),
    opening: text(2000), body: text(6000), closing: text(2000), note: text(2000), extraRefs: z.array(refSchema).max(50) }).partial().strict(),
  outline: z.object({ spec: z.object({ runtimeMin: z.number().int().min(1).max(120).nullable(), res: text(60), fps: text(60), ratio: text(60) }).strict(),
    script: text(120_000), saveVersion: z.literal(true), restore: z.number().int().positive() }).partial().strict(),
  make: z.object({ editDue: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/), editDueWhy: text(200), status: z.enum(["prep", "shoot", "edit", "done"]),
    thumb: z.object({ slot: z.enum(SLOTS), path: text(300), name: text(240) }).strict(), addFinal: z.object({ path: text(300), name: text(240), bytes: z.number().int().positive() }).strict(),
    aTitle: text(100), aReason: text(200) }).partial().strict(),
  upload: z.object({ utm: z.object({ cat: text(20), dest: text(30), camp: text(30), next: text(300), short: text(200) }).strict(),
    srt: z.object({ path: text(300), name: text(240) }).strict().nullable(), desc: text(5000), pinned: text(2000), privacy: z.enum(["private", "unlisted"]) }).partial().strict(),
} as const;
export const stageSaveSchema = z.object({ expectedVersion: z.number().int().min(0), patch: z.record(z.unknown()) }).strict();
type Patch<K extends YpStageKind> = z.infer<(typeof stagePatchSchemas)[K]>;

const locked = (message: string) => new ApiError(409, "STAGE_LOCKED", message);
function assertPlanEditable(project: YpProject, patch: Patch<"plan">) {
  const fields = editableFields(project, "draft");
  if (fields === "all") return;
  if (project.yp.gates.draft.state === "wait") throw new ApiError(409, "GATE_WAITING", "대표 컨펌을 기다리는 중이라 고칠 수 없어요. 요청을 취소하면 고칠 수 있어요.");
  const keys = Object.keys(patch) as (keyof typeof PLAN_FIELD_KEY)[];
  if (!fields.length || keys.some(key => !fields.includes(PLAN_FIELD_KEY[key])))
    throw project.yp.gates.draft.state === "changes" ? new ApiError(409, "FIELD_LOCKED", "대표가 수정 요청에서 고른 칸만 고칠 수 있어요.") : locked("기획안은 대표 컨펌을 받아 확정됐어요.");
}
function assertMakeEditable(project: YpProject, patch: Patch<"make">) {
  if (project.yp.stage === "make") return;
  if (project.yp.stage !== "review") throw locked(project.yp.stage === "upload" || project.yp.stage === "done" ? "최종 검수 컨펌이 끝나 제작은 고칠 수 없어요." : "구성안을 마치면 제작이 열려요.");
  const fields = editableFields(project, "review");
  if (fields === "all") return;
  if (project.yp.gates.review.state === "wait") throw new ApiError(409, "GATE_WAITING", "최종 검수 컨펌을 기다리는 중이라 고칠 수 없어요. 요청을 취소하면 고칠 수 있어요.");
  const needs = [patch.addFinal ? "make.final" : "", patch.thumb ? "make.thumbs" : ""].filter(Boolean);
  if (needs.some(key => !fields.includes(key))) throw new ApiError(409, "FIELD_LOCKED", "대표가 수정 요청에서 고른 칸만 고칠 수 있어요.");
}

function nextPlan(current: YpPlan, patch: Patch<"plan">, projectId: string): YpPlan {
  for (const thumb of patch.thumbs ?? []) if (thumb.path && !assetPath(projectId, "plan_thumb").test(thumb.path)) throw new ApiError(400, "ASSET_PATH_INVALID", "썸네일 시안 파일을 다시 올려 주세요.");
  return { ...current, ...patch };
}
function nextOutline(current: YpOutline, patch: Patch<"outline">, actor: RequestActor, now: string): YpOutline {
  let outline: YpOutline = { ...current, ...(patch.spec ? { spec: patch.spec } : {}), ...(patch.script !== undefined ? { script: patch.script } : {}) };
  if (patch.restore) {
    const version = outline.versions.find(item => item.v === patch.restore);
    if (!version) throw new ApiError(404, "SCRIPT_VERSION_NOT_FOUND", "그 버전을 찾지 못했어요.");
    outline = withScriptVersion(outline, version.md, actor.name, now, "restore");
  } else if (patch.saveVersion) outline = withScriptVersion(outline, outline.script, actor.name, now, "manual");
  return outline;
}
function nextMake(current: YpMake, patch: Patch<"make">, actor: RequestActor, now: string, projectId: string): YpMake {
  const make: YpMake = { ...current };
  if (patch.editDue !== undefined && patch.editDue !== current.editDue) {
    make.log = [{ at: now, by: actor.name, from: current.editDue, to: patch.editDue, why: patch.editDueWhy?.trim() ?? "" }, ...current.log].slice(0, 20);
    make.editDue = patch.editDue;
  }
  if (patch.status) { make.status = patch.status; make.statusAt = { ...current.statusAt, [patch.status]: now }; }
  if (patch.thumb) {
    if (!assetPath(projectId, "thumb").test(patch.thumb.path)) throw new ApiError(400, "ASSET_PATH_INVALID", "썸네일 파일을 다시 올려 주세요.");
    make.thumbs = { ...current.thumbs, [patch.thumb.slot]: { path: patch.thumb.path, name: patch.thumb.name, at: now } };
  }
  if (patch.addFinal) {
    if (!assetPath(projectId, "final").test(patch.addFinal.path)) throw new ApiError(400, "ASSET_PATH_INVALID", "최종본 파일을 다시 올려 주세요.");
    make.finals = [...current.finals, { v: current.finals.length + 1, at: now, by: actor.name, ...patch.addFinal }];
  }
  if (patch.aTitle !== undefined) make.aTitle = patch.aTitle.trim();
  if (patch.aReason !== undefined) make.aReason = patch.aReason;
  // 4-6: the final and the final thumbnails A · B finish 제작 by themselves.
  if (make.status !== "done" && (patch.addFinal || patch.thumb) && (current.finals.length || patch.addFinal) && !thumbsMissing(make)) { make.status = "done"; make.statusAt = { ...make.statusAt, done: now }; }
  return make;
}
function nextUpload(current: YpUpload, patch: Patch<"upload">, projectId: string): YpUpload {
  if (patch.srt && !assetPath(projectId, "srt").test(patch.srt.path)) throw new ApiError(400, "ASSET_PATH_INVALID", "SRT 파일을 다시 올려 주세요.");
  const upload = { ...current, ...patch };
  if (patch.desc !== undefined) upload.hiddenTags = hiddenTagsOf(patch.desc);
  return upload;
}

/** Writes one step record: inserted the first time, then only over the version the editor read. */
export async function writeStage<K extends YpStageKind>(supabase: Supabase, actorId: string, team: string, project: YpProject, kind: K, current: { id: string | null; version: number }, data: unknown) {
  const spec = STAGE_RECORD[kind];
  const extra = kind === "outline" ? { description: narrationFromMarkdown((data as YpOutline).script).slice(0, 100_000) } : {};
  const metadata = { [spec.key]: spec.value, projectId: project.id, yp: data, ...(kind === "outline" ? { manuscript: (data as YpOutline).script } : {}) };
  if (!current.id) {
    const { data: row, error } = await supabase.from("os_records").insert({
      id: randomUUID(), record_type: spec.recordType, title: `${projectName(project)} · ${spec.title}`.slice(0, 240), status: "active", priority: "normal",
      parent_id: project.id, owner_id: actorId, created_by: actorId, updated_by: actorId, team, tags: ["유튜브", "유튜브공정"], metadata, description: "", ...extra,
    }).select("id,version").single();
    if (error || !row) throw new ApiError(400, "STAGE_SAVE_FAILED", `${spec.title}을 저장하지 못했습니다.`);
    return row as { id: string; version: number };
  }
  const { data: row, error } = await supabase.from("os_records").update({ metadata, updated_by: actorId, ...extra })
    .eq("id", current.id).eq("version", current.version).is("archived_at", null).select("id,version").maybeSingle();
  if (error) throw new ApiError(400, "STAGE_SAVE_FAILED", `${spec.title}을 저장하지 못했습니다.`);
  if (!row) throw conflict();
  return row as { id: string; version: number };
}

const GATE_OF_STAGE: Partial<Record<YpProject["yp"]["stage"], YpGate>> = { draft: "draft", review: "review" };
/** A PD edit while a 수정 요청 is open counts as 'changed' for the re-request rule (S11-5); the list also sorts by it. */
async function touchProject(actor: RequestActor, project: YpProject) {
  const gate = GATE_OF_STAGE[project.yp.stage];
  const stale = Date.now() - Date.parse(project.yp.contentUpdatedAt) > 10 * 60_000;
  if (!stale && !(gate && project.yp.gates[gate].state === "changes")) return project;
  return saveProject(actor, project, project.version, { yp: { ...project.yp, contentUpdatedAt: new Date().toISOString() } }).catch(() => project);
}

export async function saveYoutubeStage(actor: RequestActor, id: string, kind: YpStageKind, input: z.infer<typeof stageSaveSchema>) {
  const project = await getYoutubeProject(actor, id);
  const stages = await readStages(actor.supabase, project);
  const current = stages[kind];
  if (current.version !== input.expectedVersion) throw conflict();
  const now = new Date().toISOString();
  const stage = project.yp.stage;
  let data: unknown;
  if (kind === "plan") {
    const patch = stagePatchSchemas.plan.parse(input.patch);
    if (stage !== "draft") throw locked(stage === "topic" ? "주제 컨펌 뒤에 기획안이 열려요." : "기획안은 대표 컨펌을 받아 확정됐어요.");
    assertPlanEditable(project, patch);
    data = nextPlan(stages.plan.data, patch, project.id);
  } else if (kind === "outline") {
    const patch = stagePatchSchemas.outline.parse(input.patch);
    if (!["outline", "make", "review"].includes(stage)) throw locked(["topic", "draft"].includes(stage) ? "기획안 컨펌 뒤에 구성안이 열려요." : "업로드 단계에서는 구성안을 고칠 수 없어요.");
    data = nextOutline(stages.outline.data, patch, actor, now);
  } else if (kind === "make") {
    const patch = stagePatchSchemas.make.parse(input.patch);
    assertMakeEditable(project, patch);
    data = nextMake(stages.make.data, patch, actor, now, project.id);
  } else {
    const patch = stagePatchSchemas.upload.parse(input.patch);
    if (stage !== "upload") throw locked("최종 검수 컨펌이 OK가 나야 업로드가 열려요.");
    if (stages.upload.data.run?.status === "done") throw locked("이미 유튜브에 올린 영상이에요.");
    data = nextUpload(stages.upload.data, patch, project.id);
  }
  const saved = await writeStage(actor.supabase, actor.id, actor.team, project, kind, current, data);
  const next = await touchProject(actor, project);
  return { stage: { ...saved, data }, project: next };
}

// ── Moving on (S0 '지금 할 일') ──
export const stageMoveSchema = z.object({ to: z.enum(["make", "review", "done"]), expectedVersion: z.number().int().positive() }).strict();
export async function moveYoutubeStage(actor: RequestActor, id: string, input: z.infer<typeof stageMoveSchema>) {
  const project = await getYoutubeProject(actor, id);
  if (project.version !== input.expectedVersion) throw conflict();
  const stages = await readStages(actor.supabase, project);
  const now = new Date().toISOString();
  const need = (ok: boolean, message: string) => { if (!ok) throw new ApiError(409, "STAGE_NOT_READY", message); };
  if (input.to === "make") {
    need(project.yp.stage === "outline", "구성안 단계에서만 제작으로 넘어갈 수 있어요.");
    const missing = outlineMissing(stages.outline.data);
    need(!missing, missing);
    // The 원고 the production starts from is kept as its own version (제작 시작 원고 vN).
    await writeStage(actor.supabase, actor.id, actor.team, project, "outline", stages.outline, withScriptVersion(stages.outline.data, stages.outline.data.script, actor.name, now, "make"));
  } else if (input.to === "review") {
    need(project.yp.stage === "make", "제작 단계에서만 최종 검수로 넘어갈 수 있어요.");
    need((await readFinals(actor.supabase, project.id, stages.make.data)).length > 0, "최종본을 올려주세요");
    const missing = thumbsMissing(stages.make.data);
    need(!missing, missing);
  } else {
    need(project.yp.stage === "upload" && stages.upload.data.run?.status === "done", "유튜브 업로드가 끝난 뒤에 마칠 수 있어요.");
  }
  return saveProject(actor, project, input.expectedVersion, { yp: { ...project.yp, stage: input.to, contentUpdatedAt: now } });
}

// ── Confirms on 기획안 and 최종 검수 ──
/** Why a 기획안 or 최종 검수 confirm cannot be requested yet, or "". */
async function gateMissing(actor: RequestActor, project: YpProject, gate: YpGate) {
  const stages = await readStages(actor.supabase, project);
  if (gate === "draft") return draftMissing(stages.plan.data);
  if (gate === "review") return (await readFinals(actor.supabase, project.id, stages.make.data)).length ? "" : "최종본을 올려주세요";
  return "";
}
export async function requestYoutubeGate(actor: RequestActor, id: string, gate: YpGate, input: z.infer<typeof gateActionSchema>) {
  return actOnGate(actor, id, gate, input, project => gateMissing(actor, project, gate));
}

/** The approver's decision; an OK on the 기획안 also fixes the A · B · (C) pairs later steps compare with (4-4). */
export async function decideYoutubeGate(actor: RequestActor, id: string, gate: YpGate, input: z.infer<typeof confirmActionSchema>) {
  const project = await confirmYoutubeGate(actor, id, gate, input);
  if (gate === "draft" && input.action === "ok") {
    const service = createServiceSupabase();
    const stages = await readStages(service, project);
    const plan = { ...stages.plan.data, confirmed: confirmPlan(stages.plan.data, new Date().toISOString()) };
    await writeStage(service, actor.id, actor.team, project, "plan", stages.plan, plan);
  }
  return project;
}

// ── Files (S3 시안 · S5 최종본 · 최종 썸네일 · S7 SRT) ──
const ASSET_KINDS = {
  plan_thumb: { max: 10 * 1024 * 1024, types: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" } },
  // YouTube thumbnails.set takes JPEG and PNG only (10-1).
  thumb: { max: 10 * 1024 * 1024, types: { "image/jpeg": "jpg", "image/png": "png" } },
  final: { max: 5 * 1024 * 1024 * 1024, types: { "video/mp4": "mp4", "video/quicktime": "mov", "video/x-m4v": "m4v", "video/webm": "webm" } },
  srt: { max: 5 * 1024 * 1024, types: { "application/x-subrip": "srt" } },
} as const;
export const assetCreateSchema = z.object({ kind: z.enum(["plan_thumb", "thumb", "final", "srt"]), fileName: z.string().trim().min(1).max(240), fileSize: z.number().int().positive(), mimeType: z.string().max(100) }).strict();
export async function createYoutubeAssetUpload(actor: RequestActor, id: string, input: z.infer<typeof assetCreateSchema>) {
  const project = await getYoutubeProject(actor, id);
  const spec = ASSET_KINDS[input.kind];
  // Browsers report .srt as "" or text/plain; the extension decides.
  const mimeType = input.kind === "srt" && /\.srt$/i.test(input.fileName) ? "application/x-subrip" : input.mimeType;
  const ext = (spec.types as Record<string, string>)[mimeType];
  if (!ext) throw new ApiError(400, "ASSET_TYPE_INVALID", `${Object.values(spec.types).join(" · ")} 파일만 올릴 수 있어요.`);
  if (input.fileSize > spec.max) throw new ApiError(400, "ASSET_TOO_LARGE", "파일이 너무 커요.");
  const path = `youtube/${project.id}/${input.kind}/${randomUUID()}.${ext}`;
  const { data, error } = await createServiceSupabase().storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new ApiError(502, "ASSET_UPLOAD_URL_FAILED", "파일 올릴 주소를 만들지 못했습니다.");
  return { path, token: data.token, mimeType };
}
/** A short-lived link to one of this project's files (the project must be readable by the caller). */
export async function youtubeAssetUrl(actor: RequestActor, id: string, path: string) {
  const project = await getYoutubeProject(actor, id);
  if (!new RegExp(`^youtube/${project.id}/(plan_thumb|thumb|final|srt)/[0-9a-f-]{36}\\.[a-z0-9]+$`).test(path)) throw new ApiError(400, "ASSET_PATH_INVALID", "파일 주소를 확인해 주세요.");
  const { data, error } = await createServiceSupabase().storage.from(MEDIA_BUCKET).createSignedUrl(path, 3600);
  if (error || !data) throw new ApiError(404, "ASSET_NOT_FOUND", "파일을 찾지 못했습니다.");
  return data.signedUrl;
}

// ── 스케줄 (S9) ──
export const datesSchema = z.object({ expectedVersion: z.number().int().min(0), editDue: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).optional(),
  uploadPlan: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).optional(), why: text(200).optional() }).strict();
/** Moves 편집 완료 or 업로드 (예상) from the calendar, any time before the upload; 업로드 cannot go before 편집 완료 (4-9). */
export async function moveYoutubeDates(actor: RequestActor, id: string, input: z.infer<typeof datesSchema>) {
  const project = await getYoutubeProject(actor, id);
  if (["done", "shorts"].includes(project.yp.stage)) throw locked("끝난 프로젝트예요.");
  const stages = await readStages(actor.supabase, project);
  if (stages.make.version !== input.expectedVersion) throw conflict();
  const now = new Date().toISOString();
  const make = { ...stages.make.data };
  const editDue = input.editDue ?? make.editDue;
  const uploadPlan = input.uploadPlan ?? make.uploadPlan ?? "";
  if (editDue && uploadPlan && uploadPlan < editDue) throw new ApiError(409, "DATE_ORDER", "업로드 일정은 편집 완료 일정보다 앞으로 옮길 수 없어요.");
  const log = [...make.log];
  if (input.editDue !== undefined && input.editDue !== make.editDue) log.unshift({ at: now, by: actor.name, from: make.editDue, to: input.editDue, why: input.why ?? "", field: "editDue" });
  if (input.uploadPlan !== undefined && input.uploadPlan !== (make.uploadPlan ?? "")) log.unshift({ at: now, by: actor.name, from: make.uploadPlan ?? "", to: input.uploadPlan, why: input.why ?? "", field: "uploadPlan" });
  const data = { ...make, editDue, uploadPlan, log: log.slice(0, 20) };
  const saved = await writeStage(actor.supabase, actor.id, actor.team, project, "make", stages.make, data);
  // 4-9: someone else moving a date tells the PD.
  if (project.assigneeId && project.assigneeId !== actor.id) await notify([project.assigneeId], "yt_due", project.id, `dates:${project.id}:${saved.version}`);
  return { ...saved, data };
}

/** Every project with its dates, for the calendar: one read of the projects and one of their 제작 records. */
export async function youtubeSchedule(actor: RequestActor) {
  const { data: rows, error } = await actor.supabase.from("os_records").select("id,version,title,assignee_id,owner_id,updated_at,metadata")
    .eq("record_type", "content_topic").eq("metadata->>workflow", "youtube_v1").is("archived_at", null).limit(500);
  if (error) throw readFailed();
  const projects = (rows ?? []).map(row => projectFromRecord(row)).filter((row): row is YpProject => Boolean(row));
  const ids = projects.map(row => row.id);
  const { data: makes, error: makeError } = ids.length ? await actor.supabase.from("os_records").select("id,version,parent_id,metadata").in("parent_id", ids)
    .eq("record_type", "content_package").eq("metadata->>packageKind", "yp_make").is("archived_at", null) : { data: [], error: null };
  if (makeError) throw readFailed();
  return projects.map(project => {
    const record = (makes ?? []).find(row => row.parent_id === project.id);
    const make = stageData("make", record?.metadata?.yp, project.yp.topic.type);
    const waiting = (Object.keys(project.yp.gates) as YpGate[]).find(gate => project.yp.gates[gate].state === "wait");
    return { project, makeVersion: record?.version ?? 0, editDue: make.editDue, uploadPlan: make.uploadPlan ?? "", log: make.log.filter(item => item.field).slice(0, 5),
      waiting: waiting ? { gate: waiting, requestedAt: project.yp.gates[waiting].requestedAt ?? "" } : null };
  });
}
