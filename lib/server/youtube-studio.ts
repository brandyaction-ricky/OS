import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { lockDecision, type EditLock } from "@/lib/myin-edit";
import type { OsRecord } from "@/lib/record-types";
import { createServiceSupabase } from "@/lib/supabase/server";
import { quietHours } from "@/lib/youtube-process/confirm";
import { diagnosisLink, finalPair, pinnedDraft, SLOTS, utmCode, type YpUpload } from "@/lib/youtube-process/stages";
import { STUDIO_ITEMS, STUDIO_KIND, STUDIO_PROCEDURE_TITLE, studioSettled, studioStates, testKind, type StudioTask } from "@/lib/youtube-process/studio";
import type { RequestActor } from "./auth";
import { readEndscreenCard } from "./youtube-endscreen-card";
import { youtubeConnectionStatus } from "./youtube-oauth";
import { getYoutubeProject, notify } from "./youtube-process";
import { MEDIA_BUCKET, readStages, ypUuid } from "./youtube-process-stages";

// 스튜디오 작업 (2026-11-06 staff request): one task per uploaded longform. The OS never touches Studio; the uploader's (or PD's) own AI
// reads the task over MCP, does it in Studio on their own Chrome, and reports each item. Like the editor, one person at a time.
type Service = ReturnType<typeof createServiceSupabase>;
const taskId = (projectId: string) => ypUuid(`yp-studio:${projectId}`);
const SIGNED_S = 6 * 3600;
const PC = "studio";

export const studioReportSchema = z.object({ projectId: z.string().uuid(), item: z.enum(STUDIO_ITEMS), done: z.boolean(),
  note: z.string().trim().max(1000).default(""), kind: z.string().trim().max(40).optional() }).strict()
  .refine(input => input.done || input.note, "못 한 이유를 적어 주세요.");
export const studioQueueSchema = z.object({ projectId: z.string().uuid(), item: z.enum(STUDIO_ITEMS).optional() }).strict();

async function readTask(service: Service, projectId: string) {
  const { data } = await service.from("os_records").select("*").eq("id", taskId(projectId)).is("archived_at", null).maybeSingle();
  return (data as OsRecord | null) ?? null;
}
/** A member reads what the database lets them; an AI key only a video its owner made, is assigned or uploaded. */
async function studioProject(actor: RequestActor, projectId: string, record: OsRecord | null) {
  const project = await getYoutubeProject(actor, projectId);
  if (actor.type === "agent" && ![project.ownerId, project.assigneeId, record?.created_by].includes(actor.ownerId))
    throw new ApiError(404, "VIDEO_NOT_FOUND", "이 키 주인이 만들었거나 맡았거나 올린 영상만 다룰 수 있어요.");
  return project;
}
async function nameOf(service: Service, id: string) {
  const { data } = await service.from("os_profiles").select("display_name").eq("id", id).maybeSingle();
  return (data?.display_name as string | undefined) || "구성원";
}
async function save(service: Service, record: OsRecord, task: StudioTask, settled: boolean, by: string) {
  const { data } = await service.from("os_records").update({ metadata: task, status: settled ? "done" : "backlog", updated_by: by })
    .eq("id", record.id).eq("version", record.version).select("id").maybeSingle();
  if (!data) throw new ApiError(409, "RECORD_VERSION_CONFLICT", "다른 곳에서 먼저 바꿨어요. 다시 해 주세요.");
}
const liveLock = (lock: EditLock | null | undefined) => lock && lockDecision(lock, { by: "", pc: "" }, Date.now()).kind === "held" ? lock : null;

/** After a longform goes up (or 「내 AI에게 맡기기」 for one that went up before): the video's one task, made once. */
export async function queueStudioTask(service: Service, projectId: string, videoId: string, channel: StudioTask["channel"], by: string) {
  const { data: row } = await service.from("os_records").select("title,team,brand").eq("id", projectId).maybeSingle();
  const task: StudioTask = { kind: STUDIO_KIND, videoId, queuedAt: new Date().toISOString(), channel, lock: null, reports: {} };
  const { error } = await service.from("os_records").insert({ id: taskId(projectId), record_type: "ai_job", title: `${row?.title ?? "영상"} · 스튜디오 작업`.slice(0, 240),
    description: "올린 사람의 AI가 유튜브 스튜디오에서 최종 화면 · 제목 · 썸네일 테스트 · 고정 댓글을 넣는 작업입니다.", status: "backlog", stage: "queued", priority: "normal",
    team: row?.team ?? "", brand: row?.brand ?? null, owner_id: by, parent_id: projectId, created_by: by, updated_by: by, tags: ["유튜브", "스튜디오작업"], metadata: task });
  if (error && error.code !== "23505") throw new ApiError(500, "STUDIO_TASK_CREATE_FAILED", "스튜디오 작업을 만들지 못했어요.");
}

/** The upload tab's 「맡기기」 · 「다시 맡기기」: makes the task for a video uploaded before this existed, or hands one item over again. */
export async function queueStudioAgain(actor: RequestActor, input: z.infer<typeof studioQueueSchema>) {
  const service = createServiceSupabase();
  const record = await readTask(service, input.projectId);
  const project = await studioProject(actor, input.projectId, record);
  if (!record) {
    const run = (await readStages(service, project)).upload.data.run;
    if (run?.status !== "done" || !run.videoId || project.yp.topic.type === "short") throw new ApiError(409, "UPLOAD_NOT_DONE", "롱폼을 유튜브에 올린 뒤에 맡길 수 있어요.");
    const { data } = await service.from("os_records").select("metadata").eq("parent_id", project.id).eq("record_type", "content_publish").eq("metadata->>youtubeVideoId", run.videoId).limit(1);
    const meta = (data?.[0]?.metadata ?? {}) as { channelId?: string; connectionOwnerId?: string };
    const ownerId = meta.connectionOwnerId ?? actor.ownerId;
    await queueStudioTask(service, project.id, run.videoId, { id: meta.channelId ?? "", title: (await youtubeConnectionStatus(ownerId)).channelTitle ?? "", ownerId }, actor.ownerId);
  } else if (input.item) {
    const task = record.metadata as unknown as StudioTask;
    const reports = { ...task.reports };
    delete reports[input.item];
    await save(service, record, { ...task, reports }, false, actor.ownerId);
  }
  return studioStatus(actor, input.projectId);
}

async function taskStates(service: Service, project: Awaited<ReturnType<typeof getYoutubeProject>>, task: StudioTask) {
  const stages = await readStages(service, project);
  const { plan, make, upload } = { plan: stages.plan.data, make: stages.make.data, upload: stages.upload.data };
  const run = upload.run;
  const video = { privacy: run?.privacy, publishAt: run?.publishAt ?? null, at: run?.at ?? task.queuedAt };
  const kind = testKind(plan, make);
  return { stages: { plan, make, upload }, video, kind, items: studioStates(task, video, kind, Date.now()) };
}

/** What the upload tab shows: each item's state, who holds the task now. */
export async function studioStatus(actor: RequestActor, projectId: string) {
  const service = createServiceSupabase();
  const record = await readTask(service, projectId);
  const project = await studioProject(actor, projectId, record);
  if (!record) return { projectId, task: null };
  const task = record.metadata as unknown as StudioTask;
  const { items, kind } = await taskStates(service, project, task);
  const lock = liveLock(task.lock);
  return { projectId, task: { items, testKind: kind, channel: task.channel.title, lock: lock ? { name: lock.name, since: lock.since } : null } };
}

/** The company 진단 카드 image (kept in its record as data) as a file the AI can download for six hours. */
async function cardImageUrl(service: Service, image: string) {
  const match = image.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
  if (!match) return null;
  const bytes = Buffer.from(match[2], "base64");
  const path = `youtube/endscreen-card/${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.${match[1] === "jpeg" ? "jpg" : match[1]}`;
  const store = service.storage.from(MEDIA_BUCKET);
  await store.upload(path, bytes, { contentType: `image/${match[1]}`, upsert: false }).catch(() => undefined);
  const { data } = await store.createSignedUrl(path, SIGNED_S);
  return data?.signedUrl ?? null;
}
const signed = async (service: Service, path?: string) => path ? (await service.storage.from(MEDIA_BUCKET).createSignedUrl(path, SIGNED_S)).data?.signedUrl ?? null : null;

/** Everything the AI needs in Studio for one video, in one read; start = take the task (one person at a time, a 30-minute lease). */
export async function studioTaskView(actor: RequestActor, projectId: string, start: boolean) {
  const service = createServiceSupabase();
  const record = await readTask(service, projectId);
  const project = await studioProject(actor, projectId, record);
  if (!record) throw new ApiError(404, "STUDIO_TASK_NOT_FOUND", "이 영상에는 스튜디오 작업이 없어요. 업로드 탭에서 「내 AI에게 맡기기」를 눌러 주세요.");
  let task = record.metadata as unknown as StudioTask;
  if (start) {
    const now = new Date().toISOString(), decision = lockDecision(task.lock, { by: actor.ownerId, pc: PC }, Date.now());
    if (decision.kind === "held") throw new ApiError(409, "STUDIO_TASK_BUSY", `${decision.lock.name}님이 이 영상의 스튜디오 작업을 하는 중이에요. 끝난 뒤에 해 주세요.`);
    task = { ...task, lock: { by: actor.ownerId, name: await nameOf(service, actor.ownerId), pc: PC, since: decision.kind === "renew" ? task.lock!.since : now, seenAt: now, basedOn: null } };
    await save(service, record, task, false, actor.ownerId);
  }
  const { stages: { plan, make, upload }, video, kind, items } = await taskStates(service, project, task);
  const { card } = await readEndscreenCard();
  const pinText = upload.pinned.trim();
  const { data: doc } = await service.from("os_documents").select("id,title").eq("title", STUDIO_PROCEDURE_TITLE).neq("status", "archived").limit(1);
  return {
    projectId, title: project.title, items, lock: liveLock(task.lock),
    channel: task.channel.title, video: { id: task.videoId, url: `https://www.youtube.com/watch?v=${task.videoId}`, studio: `https://studio.youtube.com/video/${task.videoId}/edit`, ...video },
    endscreen: endscreenValues(upload, card, utmCode(project.id), await cardImageUrl(service, card.image)),
    test: kind ? { kind, slots: await Promise.all(SLOTS.filter(slot => plan.confirmed?.[slot]).map(async slot => ({ slot, title: finalPair(plan, make, slot)?.title ?? "", thumbnail: await signed(service, make.thumbs[slot]?.path) }))) } : null,
    pin: { text: pinText || pinnedDraft(upload.utm), missing: pinText ? [] : ["업로드 탭 3번의 고정 댓글이 비어 있어요(빈칸 자리 표시만 있어요)."] },
    procedure: doc?.[0] ? { title: doc[0].title as string, documentId: doc[0].id as string } : null,
  };
}
function endscreenValues(upload: YpUpload, card: { name: string; cta: string; link: string; image: string }, code: string, image: string | null) {
  const missing = [...(upload.utm.next ? [] : ["이어서 볼 영상이 비어 있어요(업로드 탭 1번)."]), ...(card.name && card.image ? [] : ["진단 카드가 비어 있어요(채널/링크 관리 › 최종 화면 진단 카드)."])];
  return { place: "영상 마지막 20초 · 왼쪽에 동영상 요소(이어서 볼 영상), 오른쪽에 링크 요소(진단 카드) · 두 요소 모두 영상 끝까지",
    video: upload.utm.next || null, link: card.link || diagnosisLink(upload.utm, code), message: card.name, cta: card.cta, image, missing };
}

/** 내 AI의 예약 확인: this key owner's videos with something to do in Studio now (ready) or later (the pin's time). */
export async function listStudioTasks(actor: RequestActor) {
  const service = createServiceSupabase();
  const { data } = await service.from("os_records").select("*").eq("record_type", "ai_job").eq("metadata->>kind", STUDIO_KIND).eq("status", "backlog")
    .is("archived_at", null).order("created_at", { ascending: false }).limit(30);
  const tasks = [];
  for (const record of (data ?? []) as OsRecord[]) {
    const project = await studioProject(actor, record.parent_id!, record).catch(() => null);
    if (!project) continue;
    const task = record.metadata as unknown as StudioTask;
    const { items } = await taskStates(service, project, task);
    const lock = liveLock(task.lock);
    tasks.push({ projectId: project.id, title: project.title, channel: task.channel.title, items, lock: lock ? { name: lock.name, since: lock.since } : null });
  }
  return { tasks, now: new Date().toISOString() };
}

/** report_studio_done: one item done (등록됨) or not (못 함 · 이유). The lock is let go once nothing is ready. */
export async function reportStudio(actor: RequestActor, input: z.infer<typeof studioReportSchema>) {
  const service = createServiceSupabase();
  const record = await readTask(service, input.projectId);
  const project = await studioProject(actor, input.projectId, record);
  if (!record) throw new ApiError(404, "STUDIO_TASK_NOT_FOUND", "이 영상에는 스튜디오 작업이 없어요.");
  const task = record.metadata as unknown as StudioTask;
  const decision = lockDecision(task.lock, { by: actor.ownerId, pc: PC }, Date.now());
  if (decision.kind === "held") throw new ApiError(409, "STUDIO_TASK_BUSY", `${decision.lock.name}님이 이 영상의 스튜디오 작업을 하는 중이에요.`);
  const now = new Date().toISOString();
  const reports = { ...task.reports, [input.item]: { done: input.done, at: now, by: actor.ownerId, name: await nameOf(service, actor.ownerId), note: input.note, ...(input.kind ? { kind: input.kind } : {}) } };
  const { items } = await taskStates(service, project, { ...task, reports });
  const busy = STUDIO_ITEMS.some(item => items[item].state === "ready");
  await save(service, record, { ...task, reports, lock: busy && task.lock ? { ...task.lock, seenAt: now } : null }, studioSettled(items), actor.ownerId);
  return { projectId: project.id, items };
}

/** Hourly (YouTube cron): a pin that became possible tells whoever uploaded and the PD once, outside quiet hours. */
export async function remindStudioPins() {
  const now = new Date().toISOString();
  if (quietHours(now)) return { studioPins: 0 };
  const service = createServiceSupabase();
  const { data } = await service.from("os_records").select("*").eq("record_type", "ai_job").eq("metadata->>kind", STUDIO_KIND).eq("status", "backlog").is("archived_at", null).limit(100);
  let sent = 0;
  for (const record of (data ?? []) as OsRecord[]) {
    const project = await getYoutubeProject({ supabase: service } as unknown as RequestActor, record.parent_id!).catch(() => null);
    if (!project) continue;
    const { items } = await taskStates(service, project, record.metadata as unknown as StudioTask);
    if (items.pin.state !== "ready") continue;
    await notify([record.created_by, project.assigneeId].filter((id): id is string => Boolean(id)), "yt_due", project.id, `studio-pin:${project.id}`);
    sent += 1;
  }
  return { studioPins: sent };
}
