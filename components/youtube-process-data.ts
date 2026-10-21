"use client";

import { apiRequest, ApiRequestError, listMembers, uploadContentMedia } from "@/lib/api-client";
import { newProjectMeta, TOPIC_FIELD_OF, topicFieldEditable, topicLines, topicMissing, YP_MAX_LINES, type YpGate, type YpKind, type YpProject, type YpRef } from "@/lib/youtube-process/project";
import { applyGateAction, confirmTab, GateError, type YpApproverAction } from "@/lib/youtube-process/confirm";
import { confirmPlan, draftMissing, emptyStage, outlineMissing, scriptFromPlan, thumbsMissing, withScriptVersion, type YpStageData, type YpStageKind } from "@/lib/youtube-process/stages";
import { cutsFromScenes, scenesFromCuts, type YpShortAppeal, type YpShortBrief, type YpShortScene } from "@/lib/youtube-process/short";

export interface YpMember { id: string; name: string }
export interface YpTopicInput { title?: string; kind?: YpKind | null; target?: string; note?: string; refs?: YpRef[]; assigneeId?: string | null }
export interface YpStageView<K extends YpStageKind = YpStageKind> { id: string | null; version: number; data: YpStageData[K] }
export type YpStagesView = { [K in YpStageKind]: YpStageView<K> };
export interface YpFinalView { v: number; at: string; source: "myin" | "short" | "upload"; name: string; bytes: number; durationSeconds: number | null; runId?: string; path?: string }
/** A render PC job for a 숏폼 or a clip: backlog (기다림) · in_progress (만드는 중) · done · blocked (멈춤, with the reason code). */
export interface YpRenderView { id: string; status: string; error: string | null; at: string; duration: number }
export interface YpShortView {
  id: string; version: number; brief: YpShortBrief; scenes: YpShortScene[]; aiScenes: YpShortScene[] | null; appeals: YpShortAppeal[];
  ai: { by: string; model: string; at: string } | null; images: Record<string, { name: string; url: string }>; render: YpRenderView | null;
}
export type YpShortPatch = { brief?: Partial<YpShortBrief>; scenes?: YpShortScene[]; useAiScenes?: true };
export interface YpBundle { project: YpProject; stages: YpStagesView; finals: YpFinalView[] }
export interface YpFeedbackView {
  id: string; version: number; text: string; who: string; whoId: string; at: string; target: "video" | "A" | "B" | "C"; ver: number; t: number | null; range: [number, number] | null;
  kind: string; sug: string; reaction: boolean; status: "open" | "done" | "declined"; declinedWhy: string; fixedIn: number | null; replies: { by: string; text: string; at: string }[];
}
export type YpFeedbackInput = Partial<Pick<YpFeedbackView, "t" | "range" | "text" | "kind" | "sug" | "reaction">> & Pick<YpFeedbackView, "target" | "ver">;
export interface YpScheduleItem { project: YpProject; makeVersion: number; editDue: string; uploadPlan: string; log: { at: string; by: string; from: string; to: string; why: string; field?: string }[]; waiting: { gate: YpGate; requestedAt: string } | null }
export interface YpLegacyTopic { id: string; title: string; updatedAt: string; step: string; assigneeId: string | null }
export type YpAssetKind = "plan_thumb" | "thumb" | "final" | "srt";
export interface YpClient {
  list(): Promise<YpProject[]>;
  get(id: string): Promise<YpProject>;
  bundle(id: string): Promise<YpBundle>;
  create(input: YpTopicInput): Promise<YpProject>;
  update(id: string, expectedVersion: number, patch: YpTopicInput): Promise<YpProject>;
  topicGate(id: string, action: "request" | "cancel", expectedVersion: number, reply?: string): Promise<{ project: YpProject; created: YpProject[] }>;
  gate(id: string, gate: YpGate, action: "request" | "cancel", expectedVersion: number, reply?: string): Promise<{ project: YpProject; created: YpProject[] }>;
  saveStage<K extends YpStageKind>(id: string, kind: K, expectedVersion: number, patch: Record<string, unknown>): Promise<{ stage: YpStageView<K>; project: YpProject }>;
  move(id: string, to: "make" | "review" | "done", expectedVersion: number): Promise<YpProject>;
  uploadAsset(id: string, kind: YpAssetKind, file: File, onProgress?: (percent: number) => void): Promise<{ path: string; name: string; bytes: number }>;
  assetUrl(id: string, path: string): Promise<string>;
  finalUrl(id: string, final: YpFinalView): Promise<string | null>;
  feedback(id: string): Promise<YpFeedbackView[]>;
  addFeedback(id: string, input: YpFeedbackInput): Promise<YpFeedbackView>;
  actFeedback(id: string, itemId: string, expectedVersion: number, action: "resolve" | "reopen" | "decline" | "reply", text?: string): Promise<YpFeedbackView>;
  uploadSession(id: string, input: { fileName: string; fileSize: number; mimeType: string; connectionOwnerId?: string }): Promise<{ uploadUrl: string; finalV: number }>;
  uploadComplete(id: string, input: { videoId: string; connectionOwnerId?: string }): Promise<{ videoId: string; videoUrl: string; thumbnail: string }>;
  confirm(id: string, gate: YpGate, action: YpApproverAction, expectedVersion: number, extra?: YpConfirmExtra): Promise<YpProject>;
  confirmList(tab: "wait" | "done" | "hold"): Promise<{ project: YpProject; gate: YpGate }[]>;
  members(): Promise<YpMember[]>;
  legacy(): Promise<YpLegacyTopic[]>;
  schedule(): Promise<YpScheduleItem[]>;
  moveDates(id: string, makeVersion: number, patch: { editDue?: string; uploadPlan?: string; why?: string }): Promise<void>;
  adopt(id: string): Promise<YpProject>;
  short(id: string): Promise<YpShortView>;
  saveShort(id: string, expectedVersion: number, patch: YpShortPatch): Promise<YpShortView>;
  shortImage(id: string, file: File): Promise<{ assetId: string; url: string }>;
  renderShort(id: string, expectedVersion: number, voiceApproved: boolean): Promise<void>;
  renderClip(id: string, clipId: string): Promise<void>;
  clipRenders(id: string): Promise<Record<string, YpRenderView>>;
  shortVideoUrl(id: string, renderId: string, download?: boolean): Promise<string>;
  demo: boolean;
}
export interface YpConfirmExtra { fields?: string[]; memo?: string; reason?: string }

const json = (body: unknown) => JSON.stringify(body);

function apiClient(token: string): YpClient {
  const base = "/api/v1/content/youtube/projects";
  const gate: YpClient["gate"] = (id, name, action, expectedVersion, reply) => apiRequest(`${base}/${id}/gates/${name}`, { token, method: "POST", body: json({ action, expectedVersion, ...(reply ? { reply } : {}) }) });
  const assetUrl = async (id: string, path: string) => (await apiRequest<{ url: string }>(`${base}/${id}/assets?path=${encodeURIComponent(path)}`, { token })).url;
  const shortVideoUrl = async (id: string, renderId: string, download = false) => (await apiRequest<{ url: string }>(`${base}/${id}/short?video=${renderId}${download ? "&download=1" : ""}`, { token })).url;
  return {
    demo: false,
    list: async () => (await apiRequest<{ projects: YpProject[] }>(base, { token })).projects,
    get: async id => (await apiRequest<YpBundle>(`${base}/${id}`, { token })).project,
    bundle: id => apiRequest<YpBundle>(`${base}/${id}`, { token }),
    create: async input => (await apiRequest<{ project: YpProject }>(base, { token, method: "POST", body: json(input) })).project,
    update: async (id, expectedVersion, patch) => (await apiRequest<{ project: YpProject }>(`${base}/${id}`, { token, method: "PATCH", body: json({ ...patch, expectedVersion }) })).project,
    topicGate: (id, action, expectedVersion, reply) => gate(id, "topic", action, expectedVersion, reply),
    gate,
    saveStage: (id, kind, expectedVersion, patch) => apiRequest(`${base}/${id}/stages/${kind}`, { token, method: "PATCH", body: json({ expectedVersion, patch }) }),
    move: async (id, to, expectedVersion) => (await apiRequest<{ project: YpProject }>(`${base}/${id}/stage`, { token, method: "POST", body: json({ to, expectedVersion }) })).project,
    uploadAsset: async (id, kind, file, onProgress) => {
      const upload = await apiRequest<{ path: string; token: string; mimeType: string }>(`${base}/${id}/assets`, { token, method: "POST", body: json({ kind, fileName: file.name, fileSize: file.size, mimeType: file.type || "" }) });
      await uploadContentMedia(upload.path, upload.token, file, upload.mimeType, onProgress);
      return { path: upload.path, name: file.name, bytes: file.size };
    },
    assetUrl,
    finalUrl: async (id, final) => final.source === "short" && final.runId ? shortVideoUrl(id, final.runId)
      : final.runId ? (await apiRequest<{ video: string | null }>(`/api/v1/content/youtube-automation/myin?outputs=${final.runId}`, { token })).video
      : final.path ? assetUrl(id, final.path) : null,
    feedback: async id => (await apiRequest<{ items: YpFeedbackView[] }>(`${base}/${id}/feedback`, { token })).items,
    addFeedback: async (id, input) => (await apiRequest<{ item: YpFeedbackView }>(`${base}/${id}/feedback`, { token, method: "POST", body: json(input) })).item,
    actFeedback: async (id, itemId, expectedVersion, action, text = "") => (await apiRequest<{ item: YpFeedbackView }>(`${base}/${id}/feedback`, { token, method: "PATCH", body: json({ itemId, expectedVersion, action, text }) })).item,
    uploadSession: (id, input) => apiRequest(`${base}/${id}/upload`, { token, method: "POST", body: json({ action: "session", ...input }) }),
    uploadComplete: (id, input) => apiRequest(`${base}/${id}/upload`, { token, method: "POST", body: json({ action: "complete", ...input }) }),
    confirm: async (id, gate, action, expectedVersion, extra = {}) => (await apiRequest<{ project: YpProject }>(`/api/v1/content/youtube/confirm/${id}/${gate}`, { token, method: "POST", body: json({ action, expectedVersion, ...extra }) })).project,
    confirmList: async tab => (await apiRequest<{ items: { project: YpProject; gate: YpGate }[] }>(`/api/v1/content/youtube/confirm?tab=${tab}`, { token })).items,
    legacy: async () => (await apiRequest<{ topics: YpLegacyTopic[] }>("/api/v1/content/youtube/legacy", { token })).topics,
    schedule: async () => (await apiRequest<{ items: YpScheduleItem[] }>("/api/v1/content/youtube/schedule", { token })).items,
    moveDates: async (id, makeVersion, patch) => { await apiRequest(`${base}/${id}/dates`, { token, method: "PATCH", body: json({ expectedVersion: makeVersion, ...patch }) }); },
    adopt: async id => (await apiRequest<{ project: YpProject }>("/api/v1/content/youtube/legacy", { token, method: "POST", body: json({ id }) })).project,
    short: async id => (await apiRequest<{ short: YpShortView }>(`${base}/${id}/short`, { token })).short,
    saveShort: async (id, expectedVersion, patch) => (await apiRequest<{ short: YpShortView }>(`${base}/${id}/short`, { token, method: "PATCH", body: json({ expectedVersion, ...patch }) })).short,
    shortImage: async (id, file) => {
      // The render PC keeps the whole picture, so its size is all the OS needs to know.
      const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image(); const url = URL.createObjectURL(file);
        image.onload = () => { resolve({ width: image.naturalWidth, height: image.naturalHeight }); URL.revokeObjectURL(url); };
        image.onerror = () => { reject(new Error("이미지를 읽지 못했어요. png · jpg · webp 파일로 올려 주세요.")); URL.revokeObjectURL(url); };
        image.src = url;
      });
      if (size.width > 8000 || size.height > 8000) throw new Error("이미지는 가로 · 세로 8,000px 이하로 올려 주세요.");
      const upload = await apiRequest<{ assetId: string; path: string; token: string; mimeType: string }>(`${base}/${id}/short`, { token, method: "POST",
        body: json({ action: "image", fileName: file.name.slice(0, 240), mimeType: file.type, fileSize: file.size, ...size }) });
      await uploadContentMedia(upload.path, upload.token, file, upload.mimeType);
      return { assetId: upload.assetId, url: URL.createObjectURL(file) };
    },
    renderShort: async (id, expectedVersion, voiceApproved) => { await apiRequest(`${base}/${id}/short`, { token, method: "POST", body: json({ action: "render", expectedVersion, voiceApproved }) }); },
    renderClip: async (id, clipId) => { await apiRequest(`${base}/${id}/short`, { token, method: "POST", body: json({ action: "clip", clipId }) }); },
    clipRenders: async id => (await apiRequest<{ clips: Record<string, YpRenderView> }>(`${base}/${id}/short?clips=1`, { token })).clips,
    shortVideoUrl,
    members: async () => (await listMembers(token)).members
      .filter(member => member.is_active && !member.is_shared_account && member.member_kind !== "partner")
      .map(member => ({ id: member.id, name: member.display_name })),
  };
}

// The demo has no database; this in-memory store follows the same rules as lib/server/youtube-process*.ts.
const DEMO_ME = "demo-ricky";
const DEMO_MEMBERS: YpMember[] = [{ id: DEMO_ME, name: "리키" }, { id: "demo-logan", name: "로건" }, { id: "demo-pd", name: "예시 PD" }];
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
function demoProject(id: string, title: string, kind: YpKind, stage: YpProject["yp"]["stage"], days: number, assigneeId = DEMO_ME): YpProject {
  const meta = newProjectMeta({ type: kind, target: "퇴근 후 2시간 안에서 무엇부터 할지 막힌 30대 직장인", note: "", refs: [] }, daysAgo(days));
  if (stage !== "topic") meta.yp.gates.topic = { state: "ok", round: 1 };
  if (!["topic", "draft"].includes(stage)) meta.yp.gates.draft = { state: "ok", round: 1 };
  if (["upload", "done"].includes(stage)) meta.yp.gates.review = { state: "ok", round: 1 };
  return { id, version: 1, title, assigneeId, ownerId: DEMO_ME, updatedAt: daysAgo(days), yp: { ...meta.yp, stage } };
}
let demoStore: YpProject[] | null = null;
const demoProjects = () => demoStore ??= [
  demoProject("demo-p1", "[예시] 하루 일이 두 개뿐인데 저녁마다 지치는 이유", "anim", "topic", 0),
  demoProject("demo-p2", "[예시] 1인 창업 첫 달에 꼭 정해야 할 세 가지", "live", "draft", 1, "demo-logan"),
  demoProject("demo-p3", "[예시] 부업 수익을 세금 걱정 없이 정리하는 법", "live", "outline", 2),
  demoProject("demo-p4", "[예시] 퇴근 후 2시간 루틴 만들기", "anim", "make", 3, "demo-pd"),
  demoProject("demo-p5", "[예시] 강의 상세페이지 첫 화면 고치기", "live", "review", 5),
  demoProject("demo-p6", "[예시] 처음 쓰는 사업계획서의 순서", "anim", "upload", 8, "demo-logan"),
  demoProject("demo-p7", "[예시] 고객 인터뷰 질문 다섯 개", "live", "done", 13),
  waitingDemo(demoProject("demo-p8", "[예시] 구독자 1만 명 전에 할 일", "anim", "topic", 1, "demo-logan")),
  demoProject("demo-p9", "[예시] 강점 진단 결과지 30초 광고", "short", "make", 0),
];
/** One example waiting for the 대표 컨펌, so the confirm menu has something to show in the demo. */
function waitingDemo(project: YpProject): YpProject {
  return { ...project, yp: applyGateAction(project, "topic", "request", { actor: "demo-logan", now: daysAgo(1) }) };
}
/** Example step contents for the projects past 기획안, so each screen has something to show. */
function demoFilledStages(project: YpProject): YpStagesView {
  const kind = project.yp.topic.type;
  // Only the seeded examples carry content; a project made in the demo starts empty like a real one.
  const at = !/^demo-p\d+$/.test(project.id) || project.yp.stage === "topic" ? 0 : ["draft"].includes(project.yp.stage) ? 1 : 2;
  const plan = emptyStage("plan", kind);
  if (at >= 1) Object.assign(plan, { titles: [{ id: "t1", text: "[예시] 저녁마다 지치는 진짜 이유" }, { id: "t2", text: "[예시] 일이 두 개뿐인데 왜 힘들까" }, { id: "t3", text: "" }],
    thumbs: [{ id: "h1", mode: "text", screen: "책상에 엎드린 사람", copy: "일은 두 개인데" }, { id: "h2", mode: "text", screen: "시계와 할 일 목록", copy: "왜 지칠까" }],
    opening: "[예시] 퇴근길 지하철에서 한숨 쉬는 장면", body: "1. 결핍: 할 일이 아니라 결정이 많다\n2. 욕구: 내 기준으로 고르고 싶다\n3. 강점: 고르는 기준 세우기", closing: "[예시] 진단으로 내 기준 찾기" });
  if (at >= 2) plan.confirmed = confirmPlan(plan, daysAgo(2));
  const outline = emptyStage("outline", kind);
  if (at >= 2) Object.assign(outline, withScriptVersion({ ...outline, spec: { ...outline.spec, runtimeMin: 9 } }, scriptFromPlan(plan), "리키", daysAgo(2), "manual"));
  return { plan: { id: null, version: 0, data: plan }, outline: { id: null, version: 0, data: outline }, make: { id: null, version: 0, data: emptyStage("make", kind) }, upload: { id: null, version: 0, data: emptyStage("upload", kind) } };
}
const demoStages = new Map<string, YpStagesView>();
const demoShorts = new Map<string, YpShortView>();
const demoShort = (project: YpProject): YpShortView => demoShorts.get(project.id) ?? { id: `demo-short-${project.id}`, version: 1, scenes: [], aiScenes: null, appeals: [], ai: null, images: {}, render: null,
  brief: { purpose: "organic", duration: 30, product: "", audience: project.yp.topic.target, goal: "", landingUrl: "", evidence: "", appeal: "" } };
const demoFinals = new Map<string, YpFinalView[]>();
const demoFeedback = new Map<string, YpFeedbackView[]>();
const demoFiles = new Map<string, string>();
const demoError = (status: number, code: string, message: string) => new ApiRequestError(message, code, status);
const gateApply = (...args: Parameters<typeof applyGateAction>) => {
  try { return applyGateAction(...args); } catch (error) { throw error instanceof GateError ? demoError(error.status, error.code, error.message) : error; }
};
function demoClient(): YpClient {
  const find = (id: string) => {
    const project = demoProjects().find(row => row.id === id);
    if (!project) throw demoError(404, "YOUTUBE_PROJECT_NOT_FOUND", "프로젝트를 찾지 못했습니다.");
    return project;
  };
  const stagesOf = (project: YpProject) => { if (!demoStages.has(project.id)) demoStages.set(project.id, demoFilledStages(project)); return demoStages.get(project.id)!; };
  const put = (next: YpProject) => { demoStore = demoProjects().map(row => row.id === next.id ? next : row); return structuredClone(next); };
  const bump = (project: YpProject, yp: YpProject["yp"] = project.yp) => put({ ...project, version: project.version + 1, updatedAt: new Date().toISOString(), yp });
  const add = (title: string, input: YpTopicInput, multiFrom?: string) => {
    const now = new Date().toISOString();
    const meta = newProjectMeta({ type: input.kind ?? null, target: input.target ?? "", note: input.note ?? "", refs: input.refs ?? [] }, now, multiFrom);
    const project: YpProject = { id: `demo-${crypto.randomUUID()}`, version: 1, title, assigneeId: input.assigneeId ?? DEMO_ME, ownerId: DEMO_ME, updatedAt: now, yp: meta.yp };
    demoStore = [project, ...demoProjects()];
    return project;
  };
  const checkVersion = (version: number, expected: number) => {
    if (version !== expected) throw demoError(409, "RECORD_VERSION_CONFLICT", "다른 사람이 먼저 고쳤어요. 새로 불러와 주세요.");
  };
  const gate: YpClient["gate"] = async (id, name, action, expectedVersion, reply) => {
    const project = find(id);
    checkVersion(project.version, expectedVersion);
    const now = new Date().toISOString();
    if (action === "cancel") return { project: bump(project, gateApply(project, name, "cancel", { actor: DEMO_ME, now })), created: [] };
    if (name !== "topic") {
      const stages = stagesOf(project);
      const missing = name === "draft" ? draftMissing(stages.plan.data) : (demoFinals.get(id) ?? []).length ? "" : "최종본을 올려주세요";
      if (missing) throw demoError(400, "GATE_INCOMPLETE", missing);
      return { project: bump(project, gateApply(project, name, "request", { actor: DEMO_ME, now, reply })), created: [] };
    }
    const missing = topicMissing(project.title, project.yp.topic);
    if (missing) throw demoError(400, "TOPIC_INCOMPLETE", missing);
    const [first, ...rest] = topicLines(project.title).slice(0, YP_MAX_LINES);
    const saved = put({ ...project, title: first, version: project.version + 1, updatedAt: now, yp: gateApply(project, "topic", "request", { actor: DEMO_ME, now, reply }) });
    const created = rest.map(line => {
      const extra = add(line, { kind: project.yp.topic.type, target: project.yp.topic.target, note: project.yp.topic.note, refs: project.yp.topic.refs, assigneeId: project.assigneeId }, project.id);
      return put({ ...extra, yp: gateApply(extra, "topic", "request", { actor: DEMO_ME, now }) });
    });
    return { project: saved, created };
  };
  return {
    demo: true,
    list: async () => structuredClone(demoProjects()),
    get: async id => structuredClone(find(id)),
    bundle: async id => { const project = find(id); return structuredClone({ project, stages: stagesOf(project), finals: demoFinals.get(id) ?? [] }); },
    create: async input => structuredClone(add(input.title ?? "", input)),
    update: async (id, expectedVersion, { assigneeId, ...fields }) => {
      const project = find(id);
      checkVersion(project.version, expectedVersion);
      const content = Object.keys(fields).length > 0;
      if ((Object.keys(fields) as (keyof typeof TOPIC_FIELD_OF)[]).some(key => !topicFieldEditable(project, key))) throw demoError(409, "FIELD_LOCKED", "지금은 이 칸을 고칠 수 없어요.");
      const topic = project.yp.topic;
      return put({
        ...project, version: project.version + 1, updatedAt: new Date().toISOString(),
        title: fields.title ?? project.title, assigneeId: assigneeId !== undefined ? assigneeId : project.assigneeId,
        yp: content ? { ...project.yp, contentUpdatedAt: new Date().toISOString(), topic: { type: fields.kind !== undefined ? fields.kind : topic.type, target: fields.target ?? topic.target, note: fields.note ?? topic.note, refs: fields.refs ?? topic.refs } } : project.yp,
      });
    },
    topicGate: (id, action, expectedVersion, reply) => gate(id, "topic", action, expectedVersion, reply),
    gate,
    saveStage: async (id, kind, expectedVersion, patch) => {
      const project = find(id);
      const stages = stagesOf(project);
      const current = stages[kind];
      checkVersion(current.version, expectedVersion);
      const now = new Date().toISOString();
      let data = { ...current.data, ...patch } as YpStageData[typeof kind];
      if (kind === "outline") {
        const { saveVersion, restore, ...fields } = patch as { saveVersion?: boolean; restore?: number };
        const outline = { ...current.data, ...fields } as YpStageData["outline"];
        data = (restore ? withScriptVersion(outline, outline.versions.find(item => item.v === restore)?.md ?? outline.script, "리키", now, "restore")
          : saveVersion ? withScriptVersion(outline, outline.script, "리키", now, "manual") : outline) as YpStageData[typeof kind];
      }
      if (kind === "make") {
        const make = { ...(current.data as YpStageData["make"]) }; const p = patch as Record<string, unknown>;
        if (typeof p.editDue === "string" && p.editDue !== make.editDue) { make.log = [{ at: now, by: "리키", from: make.editDue, to: p.editDue, why: String(p.editDueWhy ?? "") }, ...make.log]; make.editDue = p.editDue; }
        if (typeof p.status === "string") { make.status = p.status as typeof make.status; make.statusAt = { ...make.statusAt, [p.status]: now }; }
        const thumb = p.thumb as { slot: "A" | "B" | "C"; path: string; name: string } | undefined;
        if (thumb) make.thumbs = { ...make.thumbs, [thumb.slot]: { path: thumb.path, name: thumb.name, at: now } };
        const final = p.addFinal as { path: string; name: string; bytes: number } | undefined;
        if (final) { make.finals = [...make.finals, { v: make.finals.length + 1, at: now, by: "리키", ...final }]; demoFinals.set(id, [...(demoFinals.get(id) ?? []), { v: (demoFinals.get(id) ?? []).length + 1, at: now, source: "upload", name: final.name, bytes: final.bytes, durationSeconds: null, path: final.path }]); }
        if (typeof p.aTitle === "string") make.aTitle = p.aTitle; if (typeof p.aReason === "string") make.aReason = p.aReason;
        if (make.status !== "done" && (final || thumb) && (demoFinals.get(id) ?? []).length && !thumbsMissing(make)) make.status = "done";
        data = make as YpStageData[typeof kind];
      }
      const stage = { id: current.id ?? `demo-${kind}-${id}`, version: current.version + 1, data } as YpStageView<typeof kind>;
      demoStages.set(id, { ...stages, [kind]: stage });
      return structuredClone({ stage, project });
    },
    move: async (id, to, expectedVersion) => {
      const project = find(id);
      checkVersion(project.version, expectedVersion);
      const stages = stagesOf(project);
      const reason = to === "make" ? outlineMissing(stages.outline.data) : to === "review" ? ((demoFinals.get(id) ?? []).length ? thumbsMissing(stages.make.data) : "최종본을 올려주세요") : "";
      if (reason) throw demoError(409, "STAGE_NOT_READY", reason);
      return bump(project, { ...project.yp, stage: to });
    },
    uploadAsset: async (_id, kind, file) => {
      const path = `youtube/demo/${kind}/${crypto.randomUUID()}.${file.name.split(".").pop()?.toLowerCase() ?? "bin"}`;
      demoFiles.set(path, URL.createObjectURL(file));
      return { path, name: file.name, bytes: file.size };
    },
    assetUrl: async (_id, path) => demoFiles.get(path) ?? "",
    finalUrl: async (_id, final) => final.path ? demoFiles.get(final.path) ?? null : null,
    feedback: async id => structuredClone(demoFeedback.get(id) ?? []),
    addFeedback: async (id, input) => {
      const item: YpFeedbackView = { id: crypto.randomUUID(), version: 1, text: input.text ?? "", who: "리키", whoId: DEMO_ME, at: new Date().toISOString(), target: input.target, ver: input.ver,
        t: input.t ?? null, range: input.range ?? null, kind: input.kind ?? "", sug: input.sug ?? "", reaction: input.reaction ?? false, status: "open", declinedWhy: "", fixedIn: null, replies: [] };
      demoFeedback.set(id, [...(demoFeedback.get(id) ?? []), item]);
      return structuredClone(item);
    },
    actFeedback: async (id, itemId, _expected, action, text = "") => {
      const items = demoFeedback.get(id) ?? [];
      const next = items.map(item => item.id !== itemId ? item : { ...item, version: item.version + 1,
        ...(action === "reply" ? { replies: [...item.replies, { by: "리키", text, at: new Date().toISOString() }] } : action === "decline" ? { status: "declined" as const, declinedWhy: text } : { status: action === "resolve" ? "done" as const : "open" as const }) });
      demoFeedback.set(id, next);
      return structuredClone(next.find(item => item.id === itemId)!);
    },
    uploadSession: async () => { throw demoError(409, "DEMO", "데모에서는 유튜브에 올리지 않아요."); },
    uploadComplete: async () => { throw demoError(409, "DEMO", "데모에서는 유튜브에 올리지 않아요."); },
    confirm: async (id, gateName, action, expectedVersion, extra = {}) => {
      const project = find(id);
      checkVersion(project.version, expectedVersion);
      const now = new Date().toISOString();
      const next = bump(project, gateApply(project, gateName, action, { actor: DEMO_ME, now, ...extra }));
      if (gateName === "draft" && action === "ok") { const stages = stagesOf(project); demoStages.set(id, { ...stages, plan: { ...stages.plan, data: { ...stages.plan.data, confirmed: confirmPlan(stages.plan.data, now) } } }); }
      return next;
    },
    confirmList: async tab => confirmTab(structuredClone(demoProjects()), tab, DEMO_ME).map(row => ({ project: row.project, gate: row.gate })),
    members: async () => DEMO_MEMBERS,
    legacy: async () => [],
    schedule: async () => demoProjects().map(project => {
      const make = stagesOf(project).make;
      const waiting = (["topic", "draft", "review"] as const).find(gate => project.yp.gates[gate].state === "wait");
      return structuredClone({ project, makeVersion: make.version, editDue: make.data.editDue, uploadPlan: make.data.uploadPlan ?? "", log: make.data.log.filter(item => item.field).slice(0, 5),
        waiting: waiting ? { gate: waiting, requestedAt: project.yp.gates[waiting].requestedAt ?? "" } : null });
    }),
    moveDates: async (id, makeVersion, patch) => {
      const project = find(id); const stages = stagesOf(project); const make = stages.make;
      checkVersion(make.version, makeVersion);
      const editDue = patch.editDue ?? make.data.editDue; const uploadPlan = patch.uploadPlan ?? make.data.uploadPlan ?? "";
      if (editDue && uploadPlan && uploadPlan < editDue) throw demoError(409, "DATE_ORDER", "업로드 일정은 편집 완료 일정보다 앞으로 옮길 수 없어요.");
      const now = new Date().toISOString();
      const log = [...(patch.editDue !== undefined ? [{ at: now, by: "리키", from: make.data.editDue, to: patch.editDue, why: patch.why ?? "", field: "editDue" as const }] : []),
        ...(patch.uploadPlan !== undefined ? [{ at: now, by: "리키", from: make.data.uploadPlan ?? "", to: patch.uploadPlan, why: patch.why ?? "", field: "uploadPlan" as const }] : []), ...make.data.log];
      demoStages.set(id, { ...stages, make: { ...make, version: make.version + 1, data: { ...make.data, editDue, uploadPlan, log } } });
    },
    adopt: async () => { throw demoError(409, "DEMO", "데모에는 이전 화면 영상이 없어요."); },
    short: async id => structuredClone(demoShort(find(id))),
    saveShort: async (id, expectedVersion, patch) => {
      const current = demoShort(find(id));
      checkVersion(current.version, expectedVersion);
      const brief = { ...current.brief, ...patch.brief };
      const scenes = patch.useAiScenes ? current.aiScenes ?? current.scenes : patch.scenes ?? current.scenes;
      const next = { ...current, version: current.version + 1, brief, scenes: scenesFromCuts(cutsFromScenes(scenes, brief.duration)), aiScenes: patch.useAiScenes ? null : current.aiScenes };
      demoShorts.set(id, next);
      return structuredClone(next);
    },
    shortImage: async (id, file) => {
      const assetId = crypto.randomUUID(), url = URL.createObjectURL(file);
      const current = demoShort(find(id));
      demoShorts.set(id, { ...current, images: { ...current.images, [assetId]: { name: file.name, url } } });
      return { assetId, url };
    },
    renderShort: async () => { throw demoError(409, "DEMO", "데모에서는 MP4를 만들지 않아요. 실제 화면에서 렌더 PC가 만들어요."); },
    renderClip: async () => { throw demoError(409, "DEMO", "데모에서는 세로 영상을 만들지 않아요."); },
    clipRenders: async () => ({}),
    shortVideoUrl: async () => "",
  };
}

export function youtubeProcessClient(token: string | null, demo: boolean): YpClient | null {
  if (demo) return demoClient();
  return token ? apiClient(token) : null;
}

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
export const isConflict = (error: unknown) => error instanceof ApiRequestError && error.status === 409 && error.code === "RECORD_VERSION_CONFLICT";
