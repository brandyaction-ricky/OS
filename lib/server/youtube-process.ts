import { z } from "zod";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { authenticateRequest, type RequestActor } from "./auth";
import { youtubeV1Enabled } from "@/lib/youtube-process/gate";
import { newProjectMeta, projectFromRecord, topicEditable, topicLines, topicMissing, YP_MAX_LINES, type YpGateInfo, type YpMeta, type YpProject, type YpTopic } from "@/lib/youtube-process/project";

const COLUMNS = "id,version,title,assignee_id,owner_id,updated_at,metadata";
const ref = z.object({ url: z.string().url().max(300), videoId: z.string().max(20).optional(), title: z.string().max(200).optional() }).strict();
const topicFields = {
  title: z.string().max(4000),
  kind: z.enum(["live", "anim"]).nullable(),
  target: z.string().max(300),
  note: z.string().max(2000),
  refs: z.array(ref).max(50),
  assigneeId: z.string().uuid().nullable(),
};
export const projectCreateSchema = z.object(topicFields).partial().strict();
export const projectPatchSchema = z.object({ ...topicFields, expectedVersion: z.number().int().positive() }).partial().required({ expectedVersion: true }).strict();
export const gateActionSchema = z.object({ action: z.enum(["request", "cancel"]), expectedVersion: z.number().int().positive() }).strict();

/** Every 유튜브 공정 v1 route: a signed-in staff member, and only while the switch is on. */
export async function youtubeActor(request: Request) {
  const actor = await authenticateRequest(request);
  if (!youtubeV1Enabled()) throw new ApiError(404, "YOUTUBE_V1_DISABLED", "유튜브 공정 화면을 사용할 수 없습니다.");
  return actor;
}

const readFailed = () => new ApiError(503, "YOUTUBE_PROJECT_READ_FAILED", "프로젝트를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
const conflict = () => new ApiError(409, "RECORD_VERSION_CONFLICT", "다른 사람이 먼저 고쳤어요. 새로 불러와 주세요.");

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

async function saveProject(actor: RequestActor, project: YpProject, expectedVersion: number, changes: { title?: string; assigneeId?: string | null; yp?: YpMeta }) {
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
  const content = Object.keys(fields).length > 0;
  // 4-1: anyone may change the PD; topic fields lock while a confirm is pending or after the topic is confirmed.
  if (content && !topicEditable(project)) {
    throw project.yp.gates.topic.state === "wait"
      ? new ApiError(409, "GATE_WAITING", "대표 컨펌을 기다리는 중이라 고칠 수 없어요. 요청을 취소하면 고칠 수 있어요.")
      : new ApiError(409, "STAGE_LOCKED", "주제는 컨펌을 받아 확정됐어요.");
  }
  await assertAssignee(actor, assigneeId);
  const topic = project.yp.topic;
  const yp: YpMeta | undefined = content ? {
    ...project.yp,
    topic: { type: fields.kind !== undefined ? fields.kind : topic.type, target: fields.target ?? topic.target, note: fields.note ?? topic.note, refs: fields.refs ?? topic.refs },
    contentUpdatedAt: new Date().toISOString(),
  } : undefined;
  return saveProject(actor, project, expectedVersion, { title: fields.title, assigneeId, yp });
}

/** Topic confirm request and its cancel (8-1). A multi-line topic becomes one waiting project per line. */
export async function actOnTopicGate(actor: RequestActor, id: string, input: z.infer<typeof gateActionSchema>) {
  const project = await getYoutubeProject(actor, id);
  if (project.version !== input.expectedVersion) throw conflict();
  const gate = project.yp.gates.topic;
  const now = new Date().toISOString();
  if (input.action === "cancel") {
    if (gate.state !== "wait") throw new ApiError(409, "INVALID_TRANSITION", "기다리는 컨펌 요청이 없어요.");
    // ponytail: a cancelled re-request returns to editing, not to the earlier 수정 요청; T4 keeps that state.
    const yp: YpMeta = { ...project.yp, gates: { ...project.yp.gates, topic: { state: "none", round: gate.round } } };
    return { project: await saveProject(actor, project, input.expectedVersion, { yp }), created: [] as YpProject[] };
  }
  if (!topicEditable(project)) throw new ApiError(409, gate.state === "wait" ? "GATE_WAITING" : "STAGE_LOCKED", gate.state === "wait" ? "이미 대표 컨펌을 기다리고 있어요." : "주제는 이미 컨펌을 받았어요.");
  const missing = topicMissing(project.title, project.yp.topic);
  if (missing) throw new ApiError(400, "TOPIC_INCOMPLETE", missing);
  const [first, ...rest] = topicLines(project.title);
  if (rest.length >= YP_MAX_LINES) throw new ApiError(400, "TOPIC_INCOMPLETE", `주제는 한 번에 ${YP_MAX_LINES}줄까지 보낼 수 있어요`);
  const waiting = (round: number): YpGateInfo => ({ state: "wait", round, requestedAt: now, requestedBy: actor.ownerId });
  const yp: YpMeta = { ...project.yp, gates: { ...project.yp.gates, topic: waiting(gate.round + 1) }, ...(rest.length ? { contentUpdatedAt: now } : {}) };
  const saved = await saveProject(actor, project, input.expectedVersion, { title: first, yp });
  // ponytail: lines after the first are inserted one by one after the first project is saved; a failure leaves the
  // projects made so far waiting (each is complete on its own). Move into one database function with T4's confirm RPC.
  const created: YpProject[] = [];
  for (const line of rest) {
    const meta = newProjectMeta(project.yp.topic, now, project.id);
    meta.yp.gates.topic = waiting(1);
    created.push(await insertProject(actor, line, project.assigneeId, meta));
  }
  return { project: saved, created };
}
