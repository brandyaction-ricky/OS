import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { diagramCatalogTypes } from "@/lib/diagram-catalog";
import { editCheckIssues, editFeed, editLoudnessIssue, editorScreenState, feedbackEditStates, lockDecision, orderMove, SCREEN_FILE, SCREEN_FILE_TYPES, SCREEN_KEEP, withLockEvent, type EditLock, type EditOrderStatus, type LockEvent, type ScreenVersion } from "@/lib/myin-edit";
import { anchorMyinCues, checkMyinStoryboard } from "@/lib/myin-storyboard";
import { parseClock } from "@/lib/youtube-process/feedback";
import type { OsRecord } from "@/lib/record-types";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { RequestActor } from "./auth";
import { readDiagramCatalog } from "./diagram-catalog";
import { editFinalSchema, myinAddEditFinal, myinEditorImageSize, myinEditorImageUpload, myinEditorImageUrl, myinEditUploads, myinFinalAt, myinFinalEngine, myinFinalForHandoff, myinFinalNumbers, myinFinalVersions, myinRunWithWords } from "./myin-run";
import { renderPcEngine } from "./youtube-render-pc";
import { currentEngineDownload, ENGINE_BUCKET, ENGINE_PART_BYTES, engineBundleSaved } from "./render-engine";
import { getYoutubeProject } from "./youtube-process";
import { actOnFeedback, listFeedback } from "./youtube-process-feedback";
import { readStages } from "./youtube-process-stages";
import { YOUTUBE_VOICE_TIMING_BUCKET } from "./youtube-voice-run";

// 영상 편집기 ②-2 (로건 개발 문서 v2, 2026-11-04): the OS side of editing a finished video on each member's own computer. One video,
// one editor (the lock); orders from each member's AI chat wait here, checked like a storyboard, until that editor takes them; the
// editor says what each became. Candidate versions stay on the computer; only a confirmed final comes to the OS, with the material
// bundle another computer needs to go on editing it.

type Service = ReturnType<typeof createServiceSupabase>;
const SESSION = "youtube_myin_edit", ORDER = "youtube_myin_edit_order";
/** 편집 화면 재료 go to the private content bucket, which takes the edit video, sound lines, pictures, JSON and SRT. */
const SCREEN_BUCKET = "os-content-media";
const versionName = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const checkSchema = editFinalSchema.shape.check;
export const confirmStartSchema = z.object({ pc: z.string().trim().min(1).max(80), fromVersion: z.string().trim().min(1).max(40), note: z.string().trim().max(500).default(""),
  engine: z.string().regex(/^[a-f0-9]{32}$/), bytes: z.number().int().positive().max(2_147_483_648), lufs: z.number().min(-70).max(0), peak: z.number().min(-70).max(3),
  bounds: z.array(z.number().int().positive()).max(2000), check: checkSchema, orders: z.array(z.string().uuid()).max(200).default([]), bundleParts: z.number().int().min(1).max(24),
  /** v3 7.2-6: the edit's own 한 장 정리 · 덱 come with it (else the OS's stay). */ handouts: z.boolean().default(false) }).strict();
const confirmingSchema = confirmStartSchema.omit({ pc: true }).extend({ id: z.string().uuid(), at: z.string(), basedOn: z.string() });
const sessionSchema = z.object({ kind: z.literal(SESSION), projectId: z.string().uuid(),
  lock: z.object({ id: z.string().uuid().optional(), by: z.string().uuid(), name: z.string(), pc: z.string(), since: z.string(), seenAt: z.string(), basedOn: z.string().nullable() }).strict().optional(),
  confirming: confirmingSchema.optional(),
  // 영상 편집기 사진 (v3 7.2-12): the pictures the video's editors put in, kept by the OS so another computer gets them too.
  images: z.array(z.object({ file: z.string(), path: z.string(), bytes: z.number().int().positive(), by: z.string(), name: z.string(), at: z.string(),
    credit: z.string().max(300).optional() }).strict()).max(200).optional(),
  history: z.array(z.object({ kind: z.enum(["lock", "handover", "unlock", "force"]), name: z.string(), pc: z.string(), at: z.string(),
    from: z.object({ name: z.string(), pc: z.string() }).strict().optional(), reason: z.string().optional() }).strict()).optional(),
  // 편집 화면 (편집 화면 이식 2026-11-05): the editing computer's versions the screen plays, a 완성 it has not finished, and the version
  // the next edits start from (되돌리기 to an earlier one).
  screen: z.object({ lockId: z.string(), versions: z.array(z.object({ name: z.string(), at: z.string(), files: z.number().int(), bytes: z.number().int(),
    from: z.string().optional(), note: z.string().optional(), final: z.string().optional() }).strict()).max(SCREEN_KEEP) }).strict().optional(),
  save: z.object({ at: z.string(), by: z.string().uuid(), name: z.string() }).strict().optional(),
  base: z.object({ version: z.string(), at: z.string(), by: z.string().uuid() }).strict().optional() }).passthrough();
const orderSchema = z.object({ kind: z.literal(ORDER), projectId: z.string().uuid(), runId: z.string().uuid(), text: z.string(), at: z.string().nullable(),
  from: z.enum(["chat", "feedback", "screen"]), feedbackIds: z.array(z.string().uuid()), by: z.string().uuid(), name: z.string(), meaning: z.string(),
  storyboard: z.string().nullable(), subtitles: z.array(z.object({ i: z.number().int().min(0), text: z.string() }).strict()),
  status: z.enum(["queued", "working", "done", "failed", "declined", "cancelled"]), result: z.object({ version: z.string().optional(), note: z.string(), at: z.string(), by: z.string() }).optional(),
  /** 손 편집 (the screen's drags and cuts, or the same said in chat): the record as the editor screen writes it, and the version it was made on. */
  manual: z.record(z.unknown()).optional(), version: z.string().optional() }).passthrough();
type Order = z.infer<typeof orderSchema>;

/** A person sees what the database lets them; an AI key or a computer's key only a video its owner made or is assigned. */
export async function editorProject(actor: RequestActor, projectId: string) {
  const project = await getYoutubeProject(actor, projectId);
  if (actor.type === "agent" && project.ownerId !== actor.ownerId && project.assigneeId !== actor.ownerId)
    throw new ApiError(404, "VIDEO_NOT_FOUND", "이 키 주인이 만들었거나 맡은 영상만 다룰 수 있어요.");
  return project;
}
const who = (actor: RequestActor) => actor.ownerId;
async function nameOf(service: Service, id: string) {
  const { data } = await service.from("os_profiles").select("display_name").eq("id", id).maybeSingle();
  return String(data?.display_name ?? "구성원");
}

async function sessionRecord(service: Service, projectId: string) {
  const { data } = await service.from("os_records").select("*").eq("parent_id", projectId).eq("record_type", "ai_job").eq("metadata->>kind", SESSION)
    .is("archived_at", null).order("created_at", { ascending: true }).limit(1);
  return (data?.[0] as OsRecord | undefined) ?? null;
}
async function projectRow(service: Service, projectId: string) {
  const { data } = await service.from("os_records").select("id,owner_id,team,brand").eq("id", projectId).maybeSingle();
  if (!data) throw new ApiError(404, "VIDEO_NOT_FOUND", "영상을 찾지 못했어요.");
  return data as { id: string; owner_id: string; team: string; brand: string | null };
}
const newRecord = (row: { owner_id: string; team: string; brand: string | null }, by: string, title: string, metadata: unknown, parent: string) =>
  ({ record_type: "ai_job", title: title.slice(0, 240), description: "", status: "backlog", priority: "normal", team: row.team, brand: row.brand,
    owner_id: row.owner_id, parent_id: parent, created_by: by, updated_by: by, tags: ["유튜브", "영상편집기"], metadata });

/** The video's lock now (a stale one reads as none). */
export async function editStatus(actor: RequestActor, projectId: string) {
  const project = await editorProject(actor, projectId);
  const service = createServiceSupabase();
  const record = await sessionRecord(service, project.id);
  const lock = record ? sessionSchema.parse(record.metadata).lock ?? null : null;
  const live = lock && lockDecision(lock, { by: "", pc: "" }, Date.now()).kind === "held" ? lock : null;
  const { data } = await service.from("os_records").select("id,version,metadata,created_at,updated_at").eq("parent_id", project.id).eq("record_type", "ai_job")
    .eq("metadata->>kind", ORDER).is("archived_at", null).order("created_at", { ascending: false }).limit(50);
  const orders = (data ?? []).map((row) => ({ id: row.id, version: row.version, at: row.created_at, updatedAt: row.updated_at, ...presentOrder(orderSchema.parse(row.metadata)) }));
  const meta = record ? sessionSchema.parse(record.metadata) : null;
  const ordered = new Set(orders.flatMap((o) => o.feedbackIds));
  const waitingFeedback = (await listFeedback(actor, project.id)).filter((f) => f.target === "video" && f.status === "open" && !f.deleted && !f.reaction && !ordered.has(f.id))
    .map((f) => ({ id: f.id, at: f.at, text: f.text, who: f.who }));
  return { projectId: project.id, lock: live, waitingFeedback, base: await myinFinalAt(service, project.id), uploadedAt: await uploadedAt(actor, project), versions: await myinFinalVersions(service, project.id),
    confirming: live && meta?.confirming ? { at: meta.confirming.at, fromVersion: meta.confirming.fromVersion } : null, history: meta?.history ?? [], orders };
}
const presentOrder = (o: Order) => ({ text: o.text, videoAt: o.at, from: o.from, feedbackIds: o.feedbackIds, name: o.name, meaning: o.meaning,
  changes: [...(o.storyboard ? ["기획표"] : []), ...(o.subtitles.length ? [`자막 ${o.subtitles.length}줄`] : []), ...(o.manual ? ["손 편집"] : [])], status: o.status, result: o.result ?? null });

/** lock · heartbeat · unlock from the editor on a member's computer (`pc` names that computer). */
export async function editLock(actor: RequestActor, projectId: string, pc: string, action: "lock" | "heartbeat" | "unlock") {
  const project = await editorProject(actor, projectId);
  const service = createServiceSupabase();
  for (let attempt = 0; attempt < 3; attempt++) {
    let record = await sessionRecord(service, project.id);
    if (!record) {
      if (action === "unlock") return { ok: true, lock: null };
      const row = await projectRow(service, project.id);
      const { data, error } = await service.from("os_records").insert(newRecord(row, who(actor), `${project.title} · 영상 편집기`, { kind: SESSION, projectId: project.id }, project.id)).select("*").maybeSingle();
      if (error || !data) throw new ApiError(500, "EDIT_SESSION_FAILED", "편집 기록을 만들지 못했어요.");
      record = data as OsRecord;
    }
    const meta = sessionSchema.parse(record.metadata), now = Date.now(), at = new Date(now).toISOString();
    const decision = lockDecision(meta.lock, { by: who(actor), pc }, now);
    if (decision.kind === "held") {
      if (action === "unlock") return { ok: true, lock: decision.lock };
      throw new ApiError(409, "EDIT_LOCKED", `${decision.lock.name}님이 편집 중이에요(${decision.lock.pc}). 보기만 할 수 있어요.`);
    }
    if (action === "heartbeat" && decision.kind === "take") throw new ApiError(409, "EDIT_LOCK_LOST", "편집 잠금이 풀렸어요. 편집기를 다시 열어 주세요.");
    const lock: EditLock | undefined = action === "unlock" ? undefined
      : decision.kind === "renew" && meta.lock ? { ...meta.lock, seenAt: at }
      : { id: randomUUID(), by: who(actor), name: await nameOf(service, who(actor)), pc, since: at, seenAt: at, basedOn: await myinFinalAt(service, project.id) };
    // 인계 기록: a new lock (taken over from a silent one names it), and the editor's own unlock; renewals are not kept.
    const event: LockEvent | null = action === "unlock" ? (decision.kind === "renew" && meta.lock ? { kind: "unlock", name: meta.lock.name, pc: meta.lock.pc, at } : null)
      : decision.kind === "take" && lock ? { kind: meta.lock ? "handover" : "lock", name: lock.name, pc, at, ...(meta.lock ? { from: { name: meta.lock.name, pc: meta.lock.pc } } : {}) } : null;
    const next = { ...meta, ...(lock ? { lock } : {}), ...(event ? { history: withLockEvent(meta.history, event) } : {}) };
    if (!lock) delete (next as { lock?: unknown }).lock;
    const { data } = await service.from("os_records").update({ metadata: next, updated_by: who(actor) }).eq("id", record.id).eq("version", record.version).select("id").maybeSingle();
    if (data) return { ok: true, lock: lock ?? null };
  }
  throw new ApiError(409, "RECORD_VERSION_CONFLICT", "다른 곳에서 먼저 바꿨어요. 다시 해 주세요.");
}

export const editOrderSchema = z.object({ text: z.string().trim().min(1).max(2000), at: z.string().trim().max(40).optional(),
  meaning: z.string().trim().max(2000).default(""), storyboard: z.record(z.unknown()).optional(),
  subtitles: z.array(z.object({ i: z.number().int().min(0).max(5000), text: z.string().trim().min(1).max(80) }).strict()).max(200).default([]),
  feedbackIds: z.array(z.string().uuid()).max(20).default([]),
  manual: z.record(z.unknown()).refine((m) => typeof m.kind === "string" && JSON.stringify(m).length <= 20_000, "손 편집 기록을 확인해 주세요.").optional(),
  version: versionName.optional() }).strict()
  .refine((o) => o.storyboard || o.subtitles.length || o.manual, "고친 기획표나 자막 줄, 손 편집이 하나는 있어야 해요.");

/** 편집 내기: an order from a member's AI chat (or the 최종 검토 feedback it answers). A changed storyboard passes the same check a new one does. */
export async function submitEditOrder(actor: RequestActor, projectId: string, input: z.infer<typeof editOrderSchema>) {
  const project = await editorProject(actor, projectId);
  const service = createServiceSupabase();
  const myin = await myinRunWithWords(service, project.id);
  let notes: string[] = [];
  let storyboard = input.storyboard;
  if (storyboard) {
    const anchored = anchorMyinCues(storyboard, myin.words, myin.speech);   // v3 7.2-4: as the transcript heard them
    storyboard = anchored.storyboard as Record<string, unknown>;
    const checked = checkMyinStoryboard(storyboard, myin.words, diagramCatalogTypes(await readDiagramCatalog()), myin.speech);
    if (checked.issues.length || !checked.story) throw new ApiError(422, "EDIT_STORYBOARD_ISSUES", `기획표 검사에서 걸린 곳 ${checked.issues.length}개: ${checked.issues.join(" / ")}`);
    notes = [...checked.notes, ...(anchored.changed.length ? [`받아쓰기에 맞춘 문구 ${anchored.changed.length}개`] : [])];
  }
  const id = randomUUID();
  const path = storyboard ? `${myin.record.owner_id}/${project.id}/edits/${id}-storyboard.json` : null;
  if (path) {
    const { error } = await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).upload(path, Buffer.from(JSON.stringify(storyboard)), { contentType: "application/json", upsert: false });
    if (error) throw new ApiError(502, "EDIT_STORYBOARD_SAVE_FAILED", "고친 기획표를 저장하지 못했어요.");
  }
  const order: Order = { kind: ORDER, projectId: project.id, runId: myin.record.id, text: input.text, at: input.at ?? null,
    from: input.feedbackIds.length ? "feedback" : input.manual && actor.type === "user" ? "screen" : "chat",
    feedbackIds: input.feedbackIds, by: who(actor), name: await nameOf(service, who(actor)), meaning: input.meaning, storyboard: path, subtitles: input.subtitles, status: "queued",
    ...(input.manual ? { manual: input.manual } : {}), ...(input.version ? { version: input.version } : {}) };
  const row = await projectRow(service, project.id);
  const { data, error } = await service.from("os_records").insert({ id, ...newRecord(row, who(actor), `${input.manual ? "손 편집" : "편집 주문"} · ${input.text}`, order, project.id) }).select("id").maybeSingle();
  if (error || !data) throw new ApiError(500, "EDIT_ORDER_FAILED", "주문을 저장하지 못했어요.");
  return { orderId: id, status: "queued" as const, notes };
}

/** The session while this person edits on this computer (their lock), or 409. */
async function heldSession(service: Service, actor: RequestActor, projectId: string, pc: string) {
  const record = await sessionRecord(service, projectId);
  const meta = record ? sessionSchema.parse(record.metadata) : null;
  if (!record || !meta?.lock || lockDecision(meta.lock, { by: who(actor), pc }, Date.now()).kind !== "renew")
    throw new ApiError(409, "EDIT_LOCK_REQUIRED", "이 컴퓨터에서 편집기를 연 사람만 할 수 있어요.");
  return { record, meta, lock: meta.lock };
}
const lockHolder = (service: Service, actor: RequestActor, projectId: string, pc: string) => heldSession(service, actor, projectId, pc).then(() => undefined);
async function saveSession(service: Service, record: OsRecord, meta: z.infer<typeof sessionSchema>, by: string) {
  const { data } = await service.from("os_records").update({ metadata: meta, updated_by: by }).eq("id", record.id).eq("version", record.version).select("id").maybeSingle();
  if (!data) throw new ApiError(409, "RECORD_VERSION_CONFLICT", "다른 곳에서 먼저 바꿨어요. 다시 해 주세요.");
}
/** When the video went up to YouTube (a computer clears its edit files two weeks after), or null. */
async function uploadedAt(actor: RequestActor, project: Awaited<ReturnType<typeof editorProject>>) {
  const run = (await readStages(actor.supabase, project)).upload.data.run;
  return run?.status === "done" ? run.at : null;
}
async function moveOrder(service: Service, row: { id: string; version: number; metadata: unknown }, to: EditOrderStatus, by: string, extra: Partial<Order> = {}) {
  const order = orderSchema.parse(row.metadata);
  if (!orderMove(order.status, to)) throw new ApiError(409, "EDIT_ORDER_STATE", "이미 처리된 주문이에요.");
  const { data } = await service.from("os_records").update({ metadata: { ...order, ...extra, status: to }, status: to === "done" ? "done" : to === "declined" ? "cancelled" : "backlog", updated_by: by })
    .eq("id", row.id).eq("version", row.version).select("id").maybeSingle();
  if (!data) throw new ApiError(409, "RECORD_VERSION_CONFLICT", "다른 곳에서 먼저 바꿨어요. 다시 해 주세요.");
}

/** The editor holding the lock takes the waiting orders, oldest first, each with its changed storyboard (readable for 30 minutes). Orders it
 *  took and has not answered come again (an editor that closed or crashed), so it skips the ids it already has. */
export async function nextEditOrders(actor: RequestActor, projectId: string, pc: string) {
  const project = await editorProject(actor, projectId);
  const service = createServiceSupabase();
  const { meta } = await heldSession(service, actor, project.id, pc);
  const { data } = await service.from("os_records").select("id,version,metadata").eq("parent_id", project.id).eq("record_type", "ai_job").eq("metadata->>kind", ORDER)
    .in("metadata->>status", ["queued", "working"]).is("archived_at", null).order("created_at", { ascending: true }).limit(200);
  // 손 편집 are not drawn while editing (편집기 v3: no render until 완성): they come only once someone pressed 완성, in the order they were made.
  const rows = (data ?? []).map((row) => ({ row, order: orderSchema.parse(row.metadata) })).filter(({ order }) => !order.manual || meta.save).slice(0, 50);
  const out = [];
  for (const { row, order } of rows) {
    if (order.status === "queued") await moveOrder(service, row, "working", who(actor));
    const signed = order.storyboard ? (await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).createSignedUrl(order.storyboard, 1_800)).data?.signedUrl ?? null : null;
    out.push({ id: row.id, text: order.text, videoAt: order.at, meaning: order.meaning, feedbackIds: order.feedbackIds, storyboardUrl: signed, subtitles: order.subtitles,
      ...(order.manual ? { manual: order.manual, version: order.version ?? null } : {}) });
  }
  return { orders: out, save: meta.save ?? null, base: meta.base?.version ?? null };
}

/** What an order became on that computer: a candidate version (it stays there), or why it could not be made. */
export async function editOrderResult(actor: RequestActor, projectId: string, pc: string, input: { orderId: string; status: "done" | "failed" | "queued"; version?: string; note?: string }) {
  const project = await editorProject(actor, projectId);
  const service = createServiceSupabase();
  await lockHolder(service, actor, project.id, pc);
  const { data: row } = await service.from("os_records").select("id,version,metadata").eq("id", input.orderId).eq("parent_id", project.id).eq("metadata->>kind", ORDER).maybeSingle();
  if (!row) throw new ApiError(404, "EDIT_ORDER_NOT_FOUND", "주문을 찾지 못했어요.");
  await moveOrder(service, row, input.status, who(actor), input.status === "queued" ? {} : { result: { ...(input.version ? { version: input.version } : {}), note: input.note ?? "", at: new Date().toISOString(), by: who(actor) } });
  return { ok: true };
}

/** 못 함: an order or a 최종 검토 feedback item the AI cannot do, with why (the feedback shows 「반영 안 함」 and the reason). */
export async function declineEdit(actor: RequestActor, projectId: string, input: { orderId?: string; feedbackId?: string; reason: string }) {
  const project = await editorProject(actor, projectId);
  const service = createServiceSupabase();
  if (input.orderId) {
    const { data: row } = await service.from("os_records").select("id,version,metadata").eq("id", input.orderId).eq("parent_id", project.id).eq("metadata->>kind", ORDER).maybeSingle();
    if (!row) throw new ApiError(404, "EDIT_ORDER_NOT_FOUND", "주문을 찾지 못했어요.");
    await moveOrder(service, row, "declined", who(actor), { result: { note: input.reason, at: new Date().toISOString(), by: who(actor) } });
  }
  if (input.feedbackId) {
    const item = (await listFeedback(actor, project.id)).find((f) => f.id === input.feedbackId);
    if (!item) throw new ApiError(404, "FEEDBACK_NOT_FOUND", "피드백을 찾지 못했어요.");
    await actOnFeedback(actor, project.id, { itemId: item.id, expectedVersion: item.version, action: "decline", text: input.reason });
  }
  return { ok: true };
}

const bundlePart = (projectId: string, confirmId: string, n: number) => `edits/${projectId}/${confirmId}/part${String(n).padStart(2, "0")}.bin`;

/**
 * 확정 1/2: the editor holding the lock asks to confirm one of its versions. It must be edited from the OS final that is newest now,
 * pass the 확정 전 자동 검사, and name an engine whose bundle the OS keeps (another computer installs that engine to go on). Returns
 * where the final, its subtitles and the material bundle's parts (≤45 MB each) go.
 */
export async function confirmStart(actor: RequestActor, projectId: string, input: z.infer<typeof confirmStartSchema>) {
  const project = await editorProject(actor, projectId);
  const service = createServiceSupabase();
  const { record, meta, lock } = await heldSession(service, actor, project.id, input.pc);
  const base = await myinFinalAt(service, project.id);
  if (!base) throw new ApiError(409, "EDIT_NO_FINAL", "OS에 완성본이 나온 뒤에 확정할 수 있어요.");
  if (lock.basedOn !== base) throw new ApiError(409, "EDIT_BASE_MOVED", "다른 곳에서 먼저 새 완성본이 나왔어요. 그 완성본에서 다시 고쳐 주세요(내 버전은 내 컴퓨터에 그대로 있어요).");
  const issues = editCheckIssues(input.check);
  if (issues.length) throw new ApiError(422, "EDIT_CHECK_FAILED", `확정 전 자동 검사에 걸렸어요: ${issues.join(" · ")}`);
  const loud = editLoudnessIssue(input.lufs, input.peak);
  if (loud) throw new ApiError(422, "EDIT_LOUDNESS", `소리 크기 검사에 걸렸어요: ${loud}`);
  if (!await engineBundleSaved(input.engine)) throw new ApiError(409, "EDIT_ENGINE_MISSING", "이 편집에 쓴 엔진 묶음이 OS에 없어요. 엔진을 다시 받은 뒤 고쳐 주세요.");
  // v3 7.2-2: an older engine is refused — the render PC's engine now, or the one that drew the final being edited (another computer
  // that took it over installs that one); anything else is out of date.
  const allowed = [await renderPcEngine(), await myinFinalEngine(service, project.id)].filter((fp): fp is string => Boolean(fp));
  if (allowed.length && !allowed.includes(input.engine)) throw new ApiError(409, "EDIT_ENGINE_OLD", "이 컴퓨터의 엔진이 오래됐어요. 실행기를 다시 켜서 새 엔진을 받은 뒤 고쳐 주세요.");
  const id = randomUUID();
  const uploads = await myinEditUploads(service, project.id, id, input.handouts);
  const storage = service.storage.from(ENGINE_BUCKET);
  const bundleUploadUrls = await Promise.all(Array.from({ length: input.bundleParts }, async (_, n) => {
    const { data, error } = await storage.createSignedUploadUrl(bundlePart(project.id, id, n), { upsert: true });
    if (error || !data) throw new ApiError(503, "EDIT_SIGN_FAILED", "재료 묶음 업로드 주소를 만들지 못했어요.");
    return data.signedUrl;
  }));
  await saveSession(service, record, { ...meta, confirming: confirmingSchema.strip().parse({ ...input, id, at: new Date().toISOString(), basedOn: base }) }, who(actor));
  return { confirmId: id, ...uploads, bundleUploadUrls, partBytes: ENGINE_PART_BYTES };
}

/**
 * 확정 2/2: everything is up. The bundle parts must be there at the sizes the computer measured; then the edit becomes the newest
 * final (myinAddEditFinal checks again that nothing landed first) and this editor goes on from it.
 */
export async function confirmFinish(actor: RequestActor, projectId: string, input: { pc: string; confirmId: string; parts: { bytes: number; sha256: string }[] }) {
  const project = await editorProject(actor, projectId);
  const service = createServiceSupabase();
  const { meta, lock } = await heldSession(service, actor, project.id, input.pc);
  const c = meta.confirming;
  if (!c || c.id !== input.confirmId) throw new ApiError(409, "EDIT_CONFIRM_MISSING", "확정을 처음부터 다시 해 주세요.");
  if (input.parts.length !== c.bundleParts) throw new ApiError(422, "EDIT_BUNDLE_PARTS", `재료 묶음 조각이 ${c.bundleParts}개여야 해요.`);
  const { data: listed } = await service.storage.from(ENGINE_BUCKET).list(`edits/${project.id}/${c.id}`, { limit: 100 });
  const sizes = new Map((listed ?? []).map((o) => [o.name, o.metadata?.size as number | undefined]));
  if (input.parts.some((part, n) => sizes.get(bundlePart(project.id, c.id, n).split("/").pop()!) !== part.bytes))
    throw new ApiError(409, "EDIT_UPLOAD_MISSING", "재료 묶음이 다 올라가지 않았어요. 다시 확정해 주세요.");
  const final = await myinAddEditFinal(service, project.id, { basedOn: c.basedOn, bytes: c.bytes, lufs: c.lufs, peak: c.peak, handouts: c.handouts,
    edit: { id: c.id, by: lock.by, name: lock.name, pc: lock.pc, fromVersion: c.fromVersion, note: c.note, engine: c.engine, bounds: c.bounds, parts: input.parts, orders: c.orders, check: c.check } });
  // v2 ④ · v3 6-6: the 최종 검토 feedback the confirmed orders answered is 반영됨 in the new version (its writer is told, as for a PD's ✓).
  let resolved = 0;
  if (c.orders.length) {
    const { data: rows } = await service.from("os_records").select("metadata").in("id", c.orders).eq("parent_id", project.id).eq("metadata->>kind", ORDER);
    const answered = new Set((rows ?? []).flatMap((row) => orderSchema.parse(row.metadata).feedbackIds));
    for (const item of answered.size ? await listFeedback(actor, project.id) : [])
      if (answered.has(item.id) && item.status === "open" && !item.deleted)
        resolved += await actOnFeedback(actor, project.id, { itemId: item.id, expectedVersion: item.version, action: "resolve", text: "" }).then(() => 1, () => 0);
  }
  // The new final is this editor's base from now on (re-read: a heartbeat may have renewed the lock meanwhile).
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = await heldSession(service, actor, project.id, input.pc).catch(() => null);
    if (!now) break;
    const next = { ...now.meta, lock: { ...now.lock, basedOn: final.at } };
    delete next.confirming; delete next.save;   // a 완성 that was waiting is this final
    if (await saveSession(service, now.record, next, who(actor)).then(() => true, () => false)) break;
  }
  return { ok: true, final: final.at, v: final.v, resolved };
}

/**
 * 다른 컴퓨터에서 이어받기: a confirmed final (the newest, or the one made at `at`) with its material bundle and the engine it was drawn
 * with, all for 10–30 minutes. A final the OS made itself has no bundle: editing starts from the run's own work folder.
 */
export async function editHandoff(actor: RequestActor, projectId: string, at?: string) {
  const project = await editorProject(actor, projectId);
  const service = createServiceSupabase();
  const final = await myinFinalForHandoff(service, project.id, at);
  const storage = service.storage.from(ENGINE_BUCKET);
  const bundle = final.edit ? await Promise.all(final.edit.parts.map(async (part, n) => {
    const { data, error } = await storage.createSignedUrl(bundlePart(project.id, final.edit!.id, n), 1_800);
    if (error || !data) throw new ApiError(503, "EDIT_SIGN_FAILED", "재료 묶음 주소를 만들지 못했어요.");
    return { ...part, url: data.signedUrl };
  })) : null;
  const session = await sessionRecord(service, project.id);
  const images = await Promise.all((session ? sessionSchema.parse(session.metadata).images ?? [] : []).map(async (image) =>
    ({ file: image.file, bytes: image.bytes, credit: image.credit ?? null, url: await myinEditorImageUrl(service, image.path) })));
  return { projectId: project.id, uploadedAt: await uploadedAt(actor, project), ...final, bundle, images,
    engine: final.edit ? await currentEngineDownload(final.edit.engine, true) : null };
}

/** 편집 소식 for the member's AI chat: what happened since `since` (an ISO time; none = everything), and the time to ask from next. */
export async function editNews(actor: RequestActor, projectId: string, since: string | null) {
  const now = new Date().toISOString();
  const state = await editStatus(actor, projectId);
  return { projectId: state.projectId, now, events: editFeed(state, since) };
}

/**
 * 관리자 강제 해제 (v3 7.2-8): an admin (a person, never an AI key) frees a video whose editor is stuck, with a reason kept in the
 * lock's record and told in the AI chat news. Whatever that computer had not confirmed stays on it.
 */
export async function forceUnlock(actor: RequestActor, projectId: string, reason: string) {
  if (actor.type !== "user" || actor.role !== "admin") throw new ApiError(403, "EDIT_ADMIN_ONLY", "편집 잠금은 관리자만 강제로 풀 수 있어요.");
  const project = await editorProject(actor, projectId);
  const service = createServiceSupabase();
  const record = await sessionRecord(service, project.id);
  const meta = record ? sessionSchema.parse(record.metadata) : null;
  if (!record || !meta?.lock) return { ok: true, released: null };
  const at = new Date().toISOString(), from = { name: meta.lock.name, pc: meta.lock.pc };
  const next = { ...meta, history: withLockEvent(meta.history, { kind: "force", name: await nameOf(service, actor.ownerId), pc: "OS", at, from, reason }) };
  delete (next as { lock?: unknown }).lock; delete next.confirming;
  await saveSession(service, record, next, actor.ownerId);
  return { ok: true, released: from };
}

/** 최종 검토 screen: where each open video feedback item is in the editor (none while nobody edits and no order answers it). */
export async function feedbackEdits(actor: RequestActor, projectId: string, items: { id: string; status: string; target: string; deleted: boolean }[]) {
  if (!items.some((item) => item.target === "video" && item.status === "open")) return {};
  // Polled with the feedback list every 30 s: only the lock and the orders, nothing else of the edit.
  const project = await editorProject(actor, projectId);
  const service = createServiceSupabase();
  const record = await sessionRecord(service, project.id);
  const lock = record ? sessionSchema.parse(record.metadata).lock : undefined;
  const { data } = await service.from("os_records").select("metadata").eq("parent_id", project.id).eq("record_type", "ai_job").eq("metadata->>kind", ORDER)
    .is("archived_at", null).order("created_at", { ascending: false }).limit(50);
  const orders = (data ?? []).map((row) => orderSchema.parse(row.metadata)).map((o) => ({ feedbackIds: o.feedbackIds, status: o.status, result: o.result ?? null }));
  return feedbackEditStates(items, orders, Boolean(lock && lockDecision(lock, { by: "", pc: "" }, Date.now()).kind === "held"));
}

/** 영상 편집기 사진 1/2 (v3 7.2-12): where the editor holding the lock puts a picture (JPG · PNG · WEBP, ≤ 20 MB). */
export async function editorImageUpload(actor: RequestActor, projectId: string, pc: string, type: string) {
  const project = await editorProject(actor, projectId);
  const service = createServiceSupabase();
  await heldSession(service, actor, project.id, pc);
  return myinEditorImageUpload(service, project.id, type);
}

/** 2/2: it landed; the video's editor keeps it (with where it came from, for the credits) and hands it to whoever takes the edit over. */
export async function editorImageSaved(actor: RequestActor, projectId: string, input: { pc: string; file: string; path: string; credit?: string }) {
  const project = await editorProject(actor, projectId);
  const service = createServiceSupabase();
  if (!/^edit-[a-f0-9-]{12}\.(jpg|png|webp)$/.test(input.file) || !input.path.endsWith(`/editor-images/${input.file}`) || !input.path.includes(`/${project.id}/`))
    throw new ApiError(400, "EDIT_IMAGE_PATH", "이미지를 다시 올려 주세요.");
  const bytes = await myinEditorImageSize(service, input.path);
  if (!bytes) throw new ApiError(409, "EDIT_IMAGE_MISSING", "올린 이미지를 찾지 못했어요. 다시 올려 주세요.");
  for (let attempt = 0; attempt < 3; attempt++) {
    const { record, meta, lock } = await heldSession(service, actor, project.id, input.pc);
    const image = { file: input.file, path: input.path, bytes, by: lock.by, name: lock.name, at: new Date().toISOString(), ...(input.credit ? { credit: input.credit } : {}) };
    const next = { ...meta, images: [...(meta.images ?? []).filter((i) => i.file !== input.file), image].slice(-200) };
    if (await saveSession(service, record, next, who(actor)).then(() => true, () => false)) return { ok: true, file: input.file, bytes };
  }
  throw new ApiError(409, "RECORD_VERSION_CONFLICT", "다른 곳에서 먼저 바꿨어요. 다시 해 주세요.");
}

// ── 편집 화면 (편집 화면 이식 2026-11-05: the editor screen in the 제작 tab) ──────────────────────────────────────────────────────────
// The screen was made on a member's computer; it reads what that computer's server gave it. Here the OS gives the same: the editing computer puts each
// version's files up (edit video, sound lines, pictures, the version's JSON), hand edits wait as orders until 완성, and a 완성 waits
// for that computer to confirm a new final.

/** The editing session the screen's files belong to (a new lock starts afresh: another computer names its versions from v1 again). */
const lockKey = (lock: EditLock & { id?: string }) => lock.id ?? createHash("sha256").update(`${lock.by}|${lock.pc}|${lock.since}`).digest("hex").slice(0, 32);
const screenDir = (ownerId: string, projectId: string, lockId: string, version: string) => `${ownerId}/${projectId}/editor/${lockId}/${version}`;
async function removeDir(service: Service, dir: string) {
  const { data } = await service.storage.from(SCREEN_BUCKET).list(dir, { limit: 1000 });
  const paths = (data ?? []).map((o) => `${dir}/${o.name}`);
  if (paths.length) await service.storage.from(SCREEN_BUCKET).remove(paths);
}
async function liveLock(service: Service, projectId: string) {
  const record = await sessionRecord(service, projectId);
  const meta = record ? sessionSchema.parse(record.metadata) : null;
  const lock = meta?.lock && lockDecision(meta.lock, { by: "", pc: "" }, Date.now()).kind === "held" ? meta.lock : null;
  return { record, meta, lock };
}
/** Retry a session change that lost a race (a heartbeat renewing the lock in between). */
async function changeSession(service: Service, projectId: string, by: string, change: (meta: z.infer<typeof sessionSchema>) => z.infer<typeof sessionSchema>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const record = await sessionRecord(service, projectId);
    if (!record) throw new ApiError(409, "EDIT_NO_EDITOR", "편집기를 연 컴퓨터가 없어요.");
    if (await saveSession(service, record, change(sessionSchema.parse(record.metadata)), by).then(() => true, () => false)) return;
  }
  throw new ApiError(409, "RECORD_VERSION_CONFLICT", "다른 곳에서 먼저 바꿨어요. 다시 해 주세요.");
}

/** 되돌리기: a hand edit not yet taken goes away; one being made or made answers where it is (the screen then goes back a version). */
export async function cancelEditOrder(actor: RequestActor, projectId: string, orderId: string) {
  const project = await editorProject(actor, projectId);
  const service = createServiceSupabase();
  const { data: row } = await service.from("os_records").select("id,version,metadata").eq("id", orderId).eq("parent_id", project.id).eq("metadata->>kind", ORDER).maybeSingle();
  if (!row) throw new ApiError(404, "EDIT_ORDER_NOT_FOUND", "편집을 찾지 못했어요.");
  const order = orderSchema.parse(row.metadata);
  if (!order.manual) throw new ApiError(409, "EDIT_NOT_HAND", "AI 채팅 주문은 채팅에서 「못 함」으로 돌려주세요.");
  if (order.status !== "queued") return { ok: false, state: order.status === "working" ? "running" : order.status };
  const { lock } = await liveLock(service, project.id);
  if (order.by !== who(actor) && lock?.by !== who(actor) && !(actor.type === "user" && actor.role === "admin"))
    throw new ApiError(403, "EDIT_NOT_YOURS", "내가 한 편집만 되돌릴 수 있어요.");
  await moveOrder(service, row, "cancelled", who(actor), { result: { note: "되돌렸어요", at: new Date().toISOString(), by: who(actor) } });
  return { ok: true };
}

/** 완성: the editing computer makes the hand edits waiting and confirms a new final (its OS number is the label). Nothing to make → same. */
export async function requestSave(actor: RequestActor, projectId: string) {
  const project = await editorProject(actor, projectId);
  const service = createServiceSupabase();
  const { meta, lock } = await liveLock(service, project.id);
  if (!lock || !meta) throw new ApiError(409, "EDIT_NO_EDITOR", "편집기를 연 컴퓨터가 없어요. 편집하는 컴퓨터에서 편집기를 열어 주세요.");
  const finals = await myinFinalNumbers(service, project.id);
  const label = `v${finals.length + 1}`;
  const { data } = await service.from("os_records").select("metadata").eq("parent_id", project.id).eq("record_type", "ai_job").eq("metadata->>kind", ORDER)
    .in("metadata->>status", ["queued", "working"]).is("archived_at", null).limit(200);
  const open = (data ?? []).length;
  if (meta.save) return { ok: true, label, waiting: open };
  const state = editorScreenState({ versions: meta.screen?.lockId === lockKey(lock) ? meta.screen.versions : [], finals, orders: [], save: null, base: null, lock: null, now: Date.now() });
  if (!open && !state.draft) return { ok: true, label: null, same: true };
  await changeSession(service, project.id, who(actor), (m) => ({ ...m, save: { at: new Date().toISOString(), by: who(actor), name: lock.name } }));
  return { ok: true, label, waiting: open };
}

/** The editing computer finished (or could not finish) a 완성 without a new final — nothing changed, or why it stopped. */
export async function saveDone(actor: RequestActor, projectId: string, pc: string) {
  const project = await editorProject(actor, projectId);
  const service = createServiceSupabase();
  await lockHolder(service, actor, project.id, pc);
  await changeSession(service, project.id, who(actor), (m) => { const next = { ...m }; delete next.save; return next; });
  return { ok: true };
}

/** 기준 버전: the next edits start from this version of the editing computer (되돌리기 past a made edit); none = its newest. */
export async function setEditBase(actor: RequestActor, projectId: string, version: string | null) {
  const project = await editorProject(actor, projectId);
  const service = createServiceSupabase();
  await changeSession(service, project.id, who(actor), (m) => {
    const next = { ...m }; delete next.base;
    if (version && !m.screen?.versions.some((v) => v.name === version)) throw new ApiError(404, "EDIT_VERSION_NOT_FOUND", "그 버전을 찾지 못했어요.");
    return version ? { ...next, base: { version, at: new Date().toISOString(), by: who(actor) } } : next;
  });
  return { ok: true };
}

export const materialsUploadSchema = z.object({ pc: z.string().trim().min(1).max(80), version: versionName,
  files: z.array(z.object({ name: z.string().regex(SCREEN_FILE, "파일 이름(영문·숫자, 폴더 없이)과 종류를 확인해 주세요."), bytes: z.number().int().positive().max(300_000_000) }).strict()).min(1).max(600) }).strict()
  .refine((d) => d.files.reduce((sum, f) => sum + f.bytes, 0) <= 600_000_000, "한 버전 재료는 600MB까지예요.");
/** 재료 올리기 1/2: where the editing computer puts one version's files (for 30 minutes). */
export async function materialsUpload(actor: RequestActor, projectId: string, input: z.infer<typeof materialsUploadSchema>) {
  const project = await editorProject(actor, projectId);
  const service = createServiceSupabase();
  const { lock } = await heldSession(service, actor, project.id, input.pc);
  const dir = screenDir((await projectRow(service, project.id)).owner_id, project.id, lockKey(lock), input.version);
  const storage = service.storage.from(SCREEN_BUCKET), out: { name: string; url: string; type: string }[] = [];
  for (let i = 0; i < input.files.length; i += 25) out.push(...await Promise.all(input.files.slice(i, i + 25).map(async (file) => {
    const { data, error } = await storage.createSignedUploadUrl(`${dir}/${file.name}`, { upsert: true });
    if (error || !data) throw new ApiError(503, "EDIT_SIGN_FAILED", "재료 업로드 주소를 만들지 못했어요.");
    return { name: file.name, url: data.signedUrl, type: SCREEN_FILE_TYPES[file.name.split(".").pop()!.toLowerCase()] };
  })));
  return { uploads: out };
}

export const materialsSavedSchema = z.object({ pc: z.string().trim().min(1).max(80), version: versionName, from: versionName.optional(), note: z.string().trim().max(300).optional(),
  /** This version is the OS final made at that time (the first final, which the editing computer took in as its own). */ final: z.string().datetime().optional() }).strict();
/** 재료 올리기 2/2: the files are up; the screen shows this version (its version.json first). Only the newest ten stay. */
export async function materialsSaved(actor: RequestActor, projectId: string, input: z.infer<typeof materialsSavedSchema>) {
  const project = await editorProject(actor, projectId);
  const service = createServiceSupabase();
  const { lock } = await heldSession(service, actor, project.id, input.pc);
  const owner = (await projectRow(service, project.id)).owner_id, lockId = lockKey(lock);
  const { data } = await service.storage.from(SCREEN_BUCKET).list(screenDir(owner, project.id, lockId, input.version), { limit: 1000 });
  const files = (data ?? []).filter((o) => SCREEN_FILE.test(o.name));
  if (!files.some((o) => o.name === "version.json")) throw new ApiError(409, "EDIT_MATERIALS_MISSING", "version.json이 올라가지 않았어요. 다시 올려 주세요.");
  const version: ScreenVersion = { name: input.version, at: new Date().toISOString(), files: files.length, bytes: files.reduce((sum, o) => sum + Number(o.metadata?.size ?? 0), 0),
    ...(input.from ? { from: input.from } : {}), ...(input.note ? { note: input.note } : {}), ...(input.final ? { final: input.final } : {}) };
  let dropped: string[] = [];
  await changeSession(service, project.id, who(actor), (m) => {
    const old = m.screen?.lockId === lockId ? m.screen.versions.filter((v) => v.name !== input.version) : [];
    const all = [...old, version];
    dropped = [...(m.screen && m.screen.lockId !== lockId ? m.screen.versions.map((v) => screenDir(owner, project.id, m.screen!.lockId, v.name)) : []),
      ...all.slice(0, Math.max(0, all.length - SCREEN_KEEP)).map((v) => screenDir(owner, project.id, lockId, v.name))];
    return { ...m, screen: { lockId, versions: all.slice(-SCREEN_KEEP) } };
  });
  for (const dir of dropped) await removeDir(service, dir).catch(() => undefined);
  return { ok: true, version };
}

/** 편집 화면 상태 (the screen asks every few seconds): light reads only — the session, the newest 200 orders, the finals' numbers. */
export async function screenView(actor: RequestActor, projectId: string) {
  const project = await editorProject(actor, projectId);
  const service = createServiceSupabase();
  const { meta, lock } = await liveLock(service, project.id);
  const { data } = await service.from("os_records").select("id,metadata,created_at").eq("parent_id", project.id).eq("record_type", "ai_job").eq("metadata->>kind", ORDER)
    .is("archived_at", null).order("created_at", { ascending: false }).limit(200);
  const orders = (data ?? []).reverse().map((row) => { const o = orderSchema.parse(row.metadata);
    return { id: row.id, at: row.created_at, text: o.text, videoAt: o.at ? parseClock(o.at) : null, version: o.version, manual: o.manual, meaning: o.meaning, status: o.status,
      result: o.result ? { version: o.result.version, note: o.result.note, at: o.result.at } : null }; });
  return editorScreenState({ versions: meta?.screen?.versions ?? [], finals: await myinFinalNumbers(service, project.id), orders, save: meta?.save ?? null,
    base: meta?.base?.version ?? null, lock: lock ? { name: lock.name, pc: lock.pc, since: lock.since } : null, now: Date.now() });
}

/** One version's files for the screen to play, readable for an hour. */
export async function screenFiles(actor: RequestActor, projectId: string, version: string) {
  const project = await editorProject(actor, projectId);
  const service = createServiceSupabase();
  const { meta } = await liveLock(service, project.id);
  if (!meta?.screen?.versions.some((v) => v.name === version)) throw new ApiError(404, "EDIT_VERSION_NOT_FOUND", "그 버전을 찾지 못했어요.");
  const dir = screenDir((await projectRow(service, project.id)).owner_id, project.id, meta.screen.lockId, version);
  const { data: listed } = await service.storage.from(SCREEN_BUCKET).list(dir, { limit: 1000 });
  const names = (listed ?? []).map((o) => o.name).filter((name) => SCREEN_FILE.test(name));
  const { data } = names.length ? await service.storage.from(SCREEN_BUCKET).createSignedUrls(names.map((name) => `${dir}/${name}`), 3_600) : { data: [] };
  return { version, files: Object.fromEntries((data ?? []).flatMap((d, i) => d.signedUrl ? [[names[i], d.signedUrl]] : [])) };
}
