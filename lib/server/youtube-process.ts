import { z } from "zod";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { authenticateRequest, type RequestActor } from "./auth";
import { youtubeV1AllowedFor } from "@/lib/youtube-process/gate";
import { newProjectMeta, projectFromRecord, projectName, TOPIC_FIELD_OF, topicFieldEditable, topicLines, topicMissing, YP_MAX_LINES, type YpGate, type YpMeta, type YpProject, type YpTopic } from "@/lib/youtube-process/project";
import { applyGateAction, confirmTab, dueReminders, GateError, nextRemindAt, quietHours, type YpApproverAction, type YpGateInput } from "@/lib/youtube-process/confirm";
import { isDesignatedApprover } from "./document-proposals";

const COLUMNS = "id,version,title,assignee_id,owner_id,updated_at,metadata";
const ref = z.object({ url: z.string().url().max(300), videoId: z.string().max(20).optional(), title: z.string().max(200).optional() }).strict();
const topicFields = {
  title: z.string().max(4000),
  kind: z.enum(["live", "anim", "short"]).nullable(),
  target: z.string().max(300),
  note: z.string().max(2000),
  refs: z.array(ref).max(50),
  assigneeId: z.string().uuid().nullable(),
};
export const projectCreateSchema = z.object(topicFields).partial().strict();
export const projectPatchSchema = z.object({ ...topicFields, expectedVersion: z.number().int().positive() }).partial().required({ expectedVersion: true }).strict();
export const gateActionSchema = z.object({ action: z.enum(["request", "cancel"]), expectedVersion: z.number().int().positive(), reply: z.string().max(200).optional() }).strict();
export const confirmActionSchema = z.object({ action: z.enum(["ok", "changes", "hold", "revert"]), expectedVersion: z.number().int().positive(),
  fields: z.array(z.string().max(40)).max(20).optional(), memo: z.string().max(1000).optional(), reason: z.string().max(300).optional() }).strict();
export const confirmTabSchema = z.enum(["wait", "done", "hold"]);

/** Every 유튜브 공정 v1 route: a signed-in staff member, and only while the switch is on for them. */
export async function youtubeActor(request: Request) {
  const actor = await authenticateRequest(request);
  if (!youtubeV1AllowedFor(actor.ownerId)) throw new ApiError(404, "YOUTUBE_V1_DISABLED", "유튜브 공정 화면을 사용할 수 없습니다.");
  return actor;
}

export const readFailed = () => new ApiError(503, "YOUTUBE_PROJECT_READ_FAILED", "프로젝트를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
export const conflict = () => new ApiError(409, "RECORD_VERSION_CONFLICT", "다른 사람이 먼저 고쳤어요. 새로 불러와 주세요.");

function asProject(row: Parameters<typeof projectFromRecord>[0] | null) {
  const project = row && projectFromRecord(row);
  if (!project) throw new ApiError(404, "YOUTUBE_PROJECT_NOT_FOUND", "프로젝트를 찾지 못했습니다.");
  return project;
}

// ponytail: up to 500 projects per read; page by contentUpdatedAt when the list outgrows it.
export async function listYoutubeProjects(actor: RequestActor) {
  const { data, error } = await actor.supabase.from("os_records").select(COLUMNS)
    .eq("record_type", "content_topic").eq("metadata->>workflow", "youtube_v1").is("archived_at", null).limit(500);
  if (error) throw readFailed();
  return (data ?? []).map(row => projectFromRecord(row)).filter((project): project is YpProject => Boolean(project));
}

export async function getYoutubeProject(actor: RequestActor, id: string) {
  const { data, error } = await actor.supabase.from("os_records").select(COLUMNS)
    .eq("id", id).eq("record_type", "content_topic").is("archived_at", null).maybeSingle();
  if (error) throw readFailed();
  return asProject(data);
}

async function assertAssignee(actor: RequestActor, assigneeId: string | null | undefined) {
  if (!assigneeId) return;
  // Profiles are read with the service client, like the members list; only the active flag is used.
  const { data, error } = await createServiceSupabase().from("os_profiles").select("id,is_active").eq("id", assigneeId).maybeSingle();
  if (error || !data?.is_active) throw new ApiError(400, "ASSIGNEE_INVALID", "담당 PD는 활동 중인 구성원에서 골라 주세요.");
}

async function insertProject(actor: RequestActor, title: string, assigneeId: string | null, meta: ReturnType<typeof newProjectMeta>) {
  const { data, error } = await actor.supabase.from("os_records").insert({
    record_type: "content_topic", title, description: "", status: "planned", priority: "normal",
    metadata: { ...meta, origin: "own" }, assignee_id: assigneeId,
    owner_id: actor.id, created_by: actor.id, updated_by: actor.id, team: actor.team,
  }).select(COLUMNS).single();
  if (error || !data) throw new ApiError(400, "YOUTUBE_PROJECT_CREATE_FAILED", "프로젝트를 만들지 못했습니다.");
  return asProject(data);
}

export async function saveProject(actor: RequestActor, project: YpProject, expectedVersion: number, changes: { title?: string; assigneeId?: string | null; yp?: YpMeta }) {
  const payload: Record<string, unknown> = { updated_by: actor.id };
  if (changes.title !== undefined) payload.title = changes.title;
  if (changes.assigneeId !== undefined) payload.assignee_id = changes.assigneeId;
  if (changes.yp) {
    // Keep every other metadata key (origin and anything a later step adds).
    const { data: current } = await actor.supabase.from("os_records").select("metadata").eq("id", project.id).maybeSingle();
    payload.metadata = { ...(current?.metadata ?? {}), workflow: "youtube_v1", yp: changes.yp };
  }
  const { data, error } = await actor.supabase.from("os_records").update(payload)
    .eq("id", project.id).eq("version", expectedVersion).is("archived_at", null).select(COLUMNS).maybeSingle();
  if (error) throw new ApiError(400, "YOUTUBE_PROJECT_UPDATE_FAILED", "프로젝트를 저장하지 못했습니다.");
  if (!data) throw conflict();
  return asProject(data);
}

export async function createYoutubeProject(actor: RequestActor, input: z.infer<typeof projectCreateSchema>) {
  await assertAssignee(actor, input.assigneeId);
  const topic: YpTopic = { type: input.kind ?? null, target: input.target ?? "", note: input.note ?? "", refs: input.refs ?? [] };
  // 4-2: no PD picked means the person who wrote the topic.
  return insertProject(actor, input.title ?? "", input.assigneeId ?? actor.ownerId, newProjectMeta(topic, new Date().toISOString()));
}

export async function updateYoutubeProject(actor: RequestActor, id: string, input: z.infer<typeof projectPatchSchema>) {
  const project = await getYoutubeProject(actor, id);
  if (project.version !== input.expectedVersion) throw conflict();
  const { expectedVersion, assigneeId, ...fields } = input;
  const keys = Object.keys(fields) as (keyof typeof TOPIC_FIELD_OF)[];
  // 4-1: anyone may change the PD; topic fields lock while a confirm waits or after it, and after 수정 요청 only the ticked ones open.
  const locked = keys.filter(key => !topicFieldEditable(project, key));
  if (locked.length) {
    const gate = project.yp.gates.topic;
    throw gate.state === "wait" ? new ApiError(409, "GATE_WAITING", "대표 컨펌을 기다리는 중이라 고칠 수 없어요. 요청을 취소하면 고칠 수 있어요.")
      : gate.state === "changes" ? new ApiError(409, "FIELD_LOCKED", "대표가 수정 요청에서 고른 칸만 고칠 수 있어요.")
      : new ApiError(409, "STAGE_LOCKED", "주제는 컨펌을 받아 확정됐어요.");
  }
  await assertAssignee(actor, assigneeId);
  const topic = project.yp.topic;
  const yp: YpMeta | undefined = keys.length ? {
    ...project.yp,
    topic: { type: fields.kind !== undefined ? fields.kind : topic.type, target: fields.target ?? topic.target, note: fields.note ?? topic.note, refs: fields.refs ?? topic.refs },
    contentUpdatedAt: new Date().toISOString(),
  } : undefined;
  return saveProject(actor, project, expectedVersion, { title: fields.title, assigneeId, yp });
}

const gateError = (error: unknown) => error instanceof GateError ? new ApiError(error.status, error.code, error.message) : error;
const apply = (project: YpProject, gate: YpGate, action: Parameters<typeof applyGateAction>[2], input: YpGateInput) => {
  try { return applyGateAction(project, gate, action, input); } catch (error) { throw gateError(error); }
};

/**
 * A confirm request (with an optional PD reply) and its cancel (8-1). `missing` says why 기획안 · 최종 검수 are not ready;
 * a multi-line topic becomes one waiting project per line.
 */
export async function actOnGate(actor: RequestActor, id: string, gate: YpGate, input: z.infer<typeof gateActionSchema>, missing: (project: YpProject) => Promise<string>) {
  const project = await getYoutubeProject(actor, id);
  if (project.version !== input.expectedVersion) throw conflict();
  const now = new Date().toISOString();
  const gateInput = { actor: actor.ownerId, now, reply: input.reply };
  if (input.action === "cancel") {
    const yp = apply(project, gate, "cancel", gateInput);
    return { project: await saveProject(actor, project, input.expectedVersion, { yp }), created: [] as YpProject[] };
  }
  const reason = gate === "topic" ? topicMissing(project.title, project.yp.topic) : await missing(project);
  if (reason) throw new ApiError(400, gate === "topic" ? "TOPIC_INCOMPLETE" : "GATE_INCOMPLETE", reason);
  if (gate !== "topic") {
    const yp = apply(project, gate, "request", gateInput);
    const saved = await saveProject(actor, project, input.expectedVersion, { yp });
    await recordConfirmation(saved, gate, "request", actor.ownerId, { memo: input.reply });
    if (!quietHours(now)) await notify(await approverIds(), "yt_confirm_request", saved.id, `confirm:${saved.id}:${gate}:${yp.gates[gate].round}:0`);
    return { project: saved, created: [] as YpProject[] };
  }
  const [first, ...rest] = topicLines(project.title);
  if (rest.length >= YP_MAX_LINES) throw new ApiError(400, "TOPIC_INCOMPLETE", `주제는 한 번에 ${YP_MAX_LINES}줄까지 보낼 수 있어요`);
  const yp = { ...apply(project, "topic", "request", gateInput), ...(rest.length ? { contentUpdatedAt: now } : {}) };
  const saved = await saveProject(actor, project, input.expectedVersion, { title: first, yp });
  // ponytail: lines after the first are inserted one by one after the first project is saved; a failure leaves the
  // projects made so far waiting (each is complete on its own). One database function can make it atomic if that matters.
  const created: YpProject[] = [];
  for (const line of rest) {
    const meta = newProjectMeta(project.yp.topic, now, project.id);
    meta.yp = applyGateAction({ yp: meta.yp }, "topic", "request", { actor: actor.ownerId, now });
    created.push(await insertProject(actor, line, project.assigneeId, meta));
  }
  for (const row of [saved, ...created]) await recordConfirmation(row, "topic", "request", actor.ownerId, { memo: input.reply });
  // 3차 결정 1: nothing at night; the 08:00 reminder announces overnight requests.
  if (!quietHours(now)) await notify(await approverIds(), "yt_confirm_request", saved.id, `confirm:${saved.id}:topic:${yp.gates.topic.round}:0`);
  return { project: saved, created };
}

// ── 대표 메뉴 › 컨펌 (S10). Confirming belongs to the company approver (D1); the server checks it on every call. ──

async function assertApprover(actor: RequestActor) {
  if (actor.type !== "user" || !(await isDesignatedApprover(actor.ownerId))) throw new ApiError(403, "NOT_APPROVER", "대표 메뉴예요. 컨펌은 회사 승인자만 할 수 있어요.");
}

/** Approvers see every project; the service client reads them so a confirm never depends on per-record sharing. */
async function allProjects() {
  const { data, error } = await createServiceSupabase().from("os_records").select(COLUMNS)
    .eq("record_type", "content_topic").eq("metadata->>workflow", "youtube_v1").is("archived_at", null).limit(500);
  if (error) throw readFailed();
  return (data ?? []).map(row => projectFromRecord(row)).filter((project): project is YpProject => Boolean(project));
}

export async function listConfirmations(actor: RequestActor, tab: z.infer<typeof confirmTabSchema>) {
  await assertApprover(actor);
  return confirmTab(await allProjects(), tab, actor.ownerId).map(row => ({ project: row.project, gate: row.gate }));
}

export async function confirmYoutubeGate(actor: RequestActor, id: string, gate: YpGate, input: z.infer<typeof confirmActionSchema>) {
  await assertApprover(actor);
  const service = createServiceSupabase();
  const { data: row, error } = await service.from("os_records").select(COLUMNS).eq("id", id).eq("record_type", "content_topic").is("archived_at", null).maybeSingle();
  if (error) throw readFailed();
  const project = asProject(row);
  if (project.version !== input.expectedVersion) throw conflict();
  const yp = apply(project, gate, input.action as YpApproverAction, { actor: actor.ownerId, now: new Date().toISOString(), fields: input.fields, memo: input.memo, reason: input.reason });
  const { data: current } = await service.from("os_records").select("metadata").eq("id", id).maybeSingle();
  const { data: saved, error: saveError } = await service.from("os_records").update({ metadata: { ...(current?.metadata ?? {}), workflow: "youtube_v1", yp }, updated_by: actor.ownerId })
    .eq("id", id).eq("version", input.expectedVersion).is("archived_at", null).select(COLUMNS).maybeSingle();
  if (saveError) throw new ApiError(400, "YOUTUBE_PROJECT_UPDATE_FAILED", "컨펌 결과를 저장하지 못했습니다.");
  if (!saved) throw conflict();
  const next = asProject(saved);
  await recordConfirmation(next, gate, input.action, actor.ownerId, { fields: input.fields, memo: input.memo ?? input.reason });
  const info = next.yp.gates[gate];
  if (input.action === "revert") await notify(await approverIds(), "yt_confirm_request", id, `confirm:${id}:${gate}:${info.round}:revert:${Date.now()}`);
  else await notify([next.assigneeId, info.requestedBy].filter((value): value is string => Boolean(value)), "yt_confirm_result", id, `result:${id}:${gate}:${info.round}:${input.action}`);
  return next;
}

/** Hourly (8-2): remind approvers of gates still waiting; several due together (the 08:00 morning) become one notice. */
export async function remindConfirmations(now = new Date().toISOString()) {
  if (quietHours(now)) return { reminded: 0 };
  const due = dueReminders(await allProjects(), now);
  if (!due.length) return { reminded: 0 };
  const approvers = await approverIds();
  const first = due[0].project;
  await notify(approvers, "yt_confirm_request", first.id, due.length > 1 ? `confirm-batch:${now.slice(0, 13)}` : `confirm:${first.id}:${due[0].gate}:${first.yp.gates[due[0].gate].round}:${now.slice(0, 13)}`);
  const service = createServiceSupabase();
  for (const { project, gate } of due) {
    const yp = { ...project.yp, gates: { ...project.yp.gates, [gate]: { ...project.yp.gates[gate], remindAt: nextRemindAt(now) } } };
    const { data: current } = await service.from("os_records").select("metadata").eq("id", project.id).maybeSingle();
    // A project changed since it was read keeps its old remindAt and is picked up next hour.
    await service.from("os_records").update({ metadata: { ...(current?.metadata ?? {}), workflow: "youtube_v1", yp } }).eq("id", project.id).eq("version", project.version);
  }
  return { reminded: due.length, batched: due.length > 1 };
}

export async function approverIds() {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await createServiceSupabase().from("os_approval_assignments").select("user_id,starts_on,ends_on").eq("kind", "approver").is("revoked_at", null);
  return [...new Set((data ?? []).filter(row => (!row.starts_on || row.starts_on <= today) && (!row.ends_on || row.ends_on >= today)).map(row => row.user_id as string))];
}

// History and notices need the M1 migration (history table, yt_* notification reasons). Until it is applied they are
// skipped and the decision itself still stands; each call says so in the server log.
export async function recordConfirmation(project: YpProject, gate: YpGate, action: string, actorId: string, extra: { fields?: string[]; memo?: string }) {
  const { error } = await createServiceSupabase().from("os_youtube_confirmations").insert({
    project_id: project.id, gate, round: Math.max(1, project.yp.gates[gate].round), action, fields: extra.fields ?? [], memo: extra.memo ?? null,
    snapshot: { title: projectName(project), topic: project.yp.topic, stage: project.yp.stage }, actor_id: actorId,
  });
  if (error) console.warn(`youtube confirm history skipped (${error.code ?? "error"})`);
}

export async function notify(recipients: string[], reason: string, sourceId: string, dedupeKey: string) {
  const service = createServiceSupabase();
  for (const ownerId of new Set(recipients)) {
    // Written as the recipient, like content automation notices; the guard keeps the metadata to these five keys.
    const { error } = await service.from("os_records").insert({ record_type: "notification", title: "업무 알림", description: "", status: "unread",
      owner_id: ownerId, created_by: ownerId, updated_by: ownerId, metadata: { sourceType: "record", sourceId, reason, readAt: "", dedupeKey: `yt:${dedupeKey}:${ownerId}` } });
    if (error && error.code !== "23505") console.warn(`youtube notice skipped (${error.code ?? "error"})`);
  }
}
