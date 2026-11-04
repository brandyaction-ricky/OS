import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { diagramCatalogTypes } from "@/lib/diagram-catalog";
import { editCheckIssues, lockDecision, orderMove, type EditLock, type EditOrderStatus } from "@/lib/myin-edit";
import { checkMyinStoryboard } from "@/lib/myin-storyboard";
import type { OsRecord } from "@/lib/record-types";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { RequestActor } from "./auth";
import { readDiagramCatalog } from "./diagram-catalog";
import { editFinalSchema, myinAddEditFinal, myinEditUploads, myinFinalAt, myinFinalForHandoff, myinRunWithWords } from "./myin-run";
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
const checkSchema = editFinalSchema.shape.check;
export const confirmStartSchema = z.object({ pc: z.string().trim().min(1).max(80), fromVersion: z.string().trim().min(1).max(40), note: z.string().trim().max(500).default(""),
  engine: z.string().regex(/^[a-f0-9]{32}$/), bytes: z.number().int().positive().max(2_147_483_648), lufs: z.number().min(-70).max(0), peak: z.number().min(-70).max(3),
  bounds: z.array(z.number().int().positive()).max(2000), check: checkSchema, orders: z.array(z.string().uuid()).max(200).default([]), bundleParts: z.number().int().min(1).max(24) }).strict();
const confirmingSchema = confirmStartSchema.omit({ pc: true }).extend({ id: z.string().uuid(), at: z.string(), basedOn: z.string() });
const sessionSchema = z.object({ kind: z.literal(SESSION), projectId: z.string().uuid(),
  lock: z.object({ by: z.string().uuid(), name: z.string(), pc: z.string(), since: z.string(), seenAt: z.string(), basedOn: z.string().nullable() }).strict().optional(),
  confirming: confirmingSchema.optional() }).passthrough();
const orderSchema = z.object({ kind: z.literal(ORDER), projectId: z.string().uuid(), runId: z.string().uuid(), text: z.string(), at: z.string().nullable(),
  from: z.enum(["chat", "feedback"]), feedbackIds: z.array(z.string().uuid()), by: z.string().uuid(), name: z.string(), meaning: z.string(),
  storyboard: z.string().nullable(), subtitles: z.array(z.object({ i: z.number().int().min(0), text: z.string() }).strict()),
  status: z.enum(["queued", "working", "done", "failed", "declined"]), result: z.object({ version: z.string().optional(), note: z.string(), at: z.string(), by: z.string() }).optional() }).passthrough();
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
  const { data } = await service.from("os_records").select("id,version,metadata,created_at").eq("parent_id", project.id).eq("record_type", "ai_job")
    .eq("metadata->>kind", ORDER).is("archived_at", null).order("created_at", { ascending: false }).limit(50);
  const orders = (data ?? []).map((row) => ({ id: row.id, version: row.version, at: row.created_at, ...presentOrder(orderSchema.parse(row.metadata)) }));
  const meta = record ? sessionSchema.parse(record.metadata) : null;
  return { projectId: project.id, lock: live, base: await myinFinalAt(service, project.id), uploadedAt: await uploadedAt(actor, project),
    confirming: live && meta?.confirming ? { at: meta.confirming.at, fromVersion: meta.confirming.fromVersion } : null, orders };
}
const presentOrder = (o: Order) => ({ text: o.text, videoAt: o.at, from: o.from, feedbackIds: o.feedbackIds, name: o.name, meaning: o.meaning,
  changes: [...(o.storyboard ? ["기획표"] : []), ...(o.subtitles.length ? [`자막 ${o.subtitles.length}줄`] : [])], status: o.status, result: o.result ?? null });

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
      : { by: who(actor), name: await nameOf(service, who(actor)), pc, since: at, seenAt: at, basedOn: await myinFinalAt(service, project.id) };
    const next = { ...meta, ...(lock ? { lock } : {}) };
    if (!lock) delete (next as { lock?: unknown }).lock;
    const { data } = await service.from("os_records").update({ metadata: next, updated_by: who(actor) }).eq("id", record.id).eq("version", record.version).select("id").maybeSingle();
    if (data) return { ok: true, lock: lock ?? null };
  }
  throw new ApiError(409, "RECORD_VERSION_CONFLICT", "다른 곳에서 먼저 바꿨어요. 다시 해 주세요.");
}

export const editOrderSchema = z.object({ text: z.string().trim().min(1).max(2000), at: z.string().trim().max(40).optional(),
  meaning: z.string().trim().max(2000).default(""), storyboard: z.record(z.unknown()).optional(),
  subtitles: z.array(z.object({ i: z.number().int().min(0).max(5000), text: z.string().trim().min(1).max(80) }).strict()).max(200).default([]),
  feedbackIds: z.array(z.string().uuid()).max(20).default([]) }).strict()
  .refine((o) => o.storyboard || o.subtitles.length, "고친 기획표나 자막 줄이 하나는 있어야 해요.");

/** 편집 내기: an order from a member's AI chat (or the 최종 검토 feedback it answers). A changed storyboard passes the same check a new one does. */
export async function submitEditOrder(actor: RequestActor, projectId: string, input: z.infer<typeof editOrderSchema>) {
  const project = await editorProject(actor, projectId);
  const service = createServiceSupabase();
  const myin = await myinRunWithWords(service, project.id);
  let notes: string[] = [];
  if (input.storyboard) {
    const checked = checkMyinStoryboard(input.storyboard, myin.words, diagramCatalogTypes(await readDiagramCatalog()), myin.speech);
    if (checked.issues.length || !checked.story) throw new ApiError(422, "EDIT_STORYBOARD_ISSUES", `기획표 검사에서 걸린 곳 ${checked.issues.length}개: ${checked.issues.join(" / ")}`);
    notes = checked.notes;
  }
  const id = randomUUID();
  const path = input.storyboard ? `${myin.record.owner_id}/${project.id}/edits/${id}-storyboard.json` : null;
  if (path) {
    const { error } = await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).upload(path, Buffer.from(JSON.stringify(input.storyboard)), { contentType: "application/json", upsert: false });
    if (error) throw new ApiError(502, "EDIT_STORYBOARD_SAVE_FAILED", "고친 기획표를 저장하지 못했어요.");
  }
  const order: Order = { kind: ORDER, projectId: project.id, runId: myin.record.id, text: input.text, at: input.at ?? null, from: input.feedbackIds.length ? "feedback" : "chat",
    feedbackIds: input.feedbackIds, by: who(actor), name: await nameOf(service, who(actor)), meaning: input.meaning, storyboard: path, subtitles: input.subtitles, status: "queued" };
  const row = await projectRow(service, project.id);
  const { data, error } = await service.from("os_records").insert({ id, ...newRecord(row, who(actor), `편집 주문 · ${input.text}`, order, project.id) }).select("id").maybeSingle();
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
  await lockHolder(service, actor, project.id, pc);
  const { data } = await service.from("os_records").select("id,version,metadata").eq("parent_id", project.id).eq("record_type", "ai_job").eq("metadata->>kind", ORDER)
    .in("metadata->>status", ["queued", "working"]).is("archived_at", null).order("created_at", { ascending: true }).limit(10);
  const out = [];
  for (const row of data ?? []) {
    const order = orderSchema.parse(row.metadata);
    if (order.status === "queued") await moveOrder(service, row, "working", who(actor));
    const signed = order.storyboard ? (await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).createSignedUrl(order.storyboard, 1_800)).data?.signedUrl ?? null : null;
    out.push({ id: row.id, text: order.text, videoAt: order.at, meaning: order.meaning, feedbackIds: order.feedbackIds, storyboardUrl: signed, subtitles: order.subtitles });
  }
  return { orders: out };
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
  if (!await engineBundleSaved(input.engine)) throw new ApiError(409, "EDIT_ENGINE_MISSING", "이 편집에 쓴 엔진 묶음이 OS에 없어요. 엔진을 다시 받은 뒤 고쳐 주세요.");
  const id = randomUUID();
  const uploads = await myinEditUploads(service, project.id, id);
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
  const final = await myinAddEditFinal(service, project.id, { basedOn: c.basedOn, bytes: c.bytes, lufs: c.lufs, peak: c.peak,
    edit: { id: c.id, by: lock.by, name: lock.name, pc: lock.pc, fromVersion: c.fromVersion, note: c.note, engine: c.engine, bounds: c.bounds, parts: input.parts, orders: c.orders, check: c.check } });
  // The new final is this editor's base from now on (re-read: a heartbeat may have renewed the lock meanwhile).
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = await heldSession(service, actor, project.id, input.pc).catch(() => null);
    if (!now) break;
    const next = { ...now.meta, lock: { ...now.lock, basedOn: final.at } };
    delete next.confirming;
    if (await saveSession(service, now.record, next, who(actor)).then(() => true, () => false)) break;
  }
  return { ok: true, final: final.at, v: final.v };
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
  return { projectId: project.id, uploadedAt: await uploadedAt(actor, project), ...final, bundle,
    engine: final.edit ? await currentEngineDownload(final.edit.engine) : null };
}
