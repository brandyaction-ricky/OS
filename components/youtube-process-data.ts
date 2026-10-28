"use client";

import { apiRequest, ApiRequestError, listMembers, listRecords, uploadContentMedia } from "@/lib/api-client";
import type { OsRecord } from "@/lib/record-types";
import { newProjectMeta, TOPIC_FIELD_OF, topicFieldEditable, topicLines, topicMissing, trashDaysLeft, YP_MAX_LINES, type YpGate, type YpKind, type YpProject, type YpRef, type YpTrashed } from "@/lib/youtube-process/project";
import { applyGateAction, confirmTab, GateError, type YpApproverAction } from "@/lib/youtube-process/confirm";
import { columnSignature, confirmPlan, draftMissing, emptyStage, outlineMissing, scriptFromPlan, thumbsMissing, withScriptVersion, type YpStageData, type YpStageKind, type YpStoredFormula } from "@/lib/youtube-process/stages";
import { shortScriptMissing, type YpShortRefFetch } from "@/lib/youtube-process/short-script";
import { columnMeta } from "@/lib/seo-column";
import { cutsFromScenes, scenesFromCuts, shortsAction, type YpShortAppeal, type YpShortBrief, type YpShortScene } from "@/lib/youtube-process/short";

export interface YpMember { id: string; name: string }
export interface YpTopicInput { title?: string; kind?: YpKind | null; target?: string; note?: string; refs?: YpRef[]; assigneeId?: string | null }
export interface YpStageView<K extends YpStageKind = YpStageKind> { id: string | null; version: number; data: YpStageData[K] }
export type YpStagesView = { [K in YpStageKind]: YpStageView<K> };
export interface YpFinalView { v: number; at: string; source: "myin" | "short" | "upload"; name: string; bytes: number; durationSeconds: number | null; runId?: string; path?: string; aspect?: "1:1" | "4:5" }
/** A render PC job for a 숏폼 or a clip: backlog (기다림) · in_progress (만드는 중) · done · blocked (멈춤, with the reason code). */
export interface YpRenderView { id: string; status: string; error: string | null; at: string; duration: number }
export interface YpShortView {
  id: string; version: number; brief: YpShortBrief; scenes: YpShortScene[]; aiScenes: YpShortScene[] | null; appeals: YpShortAppeal[];
  ai: { by: string; model: string; at: string } | null; images: Record<string, { name: string; url: string }>; render: YpRenderView | null; square?: YpRenderView | null; portrait?: YpRenderView | null;
}
export type YpShortPatch = { brief?: Partial<YpShortBrief>; scenes?: YpShortScene[]; useAiScenes?: true };
/** formulas: the company 숏폼 공식 창고, sent with a 숏폼's bundle (대본 step). */
export interface YpBundle { project: YpProject; stages: YpStagesView; finals: YpFinalView[]; formulas?: YpStoredFormula[] }
export interface YpFeedbackView {
  id: string; version: number; text: string; who: string; whoId: string; at: string; target: "video" | "A" | "B" | "C"; ver: number; t: number | null; range: [number, number] | null;
  kind: string; sug: string; reaction: boolean; status: "open" | "done" | "declined"; declinedWhy: string; fixedIn: number | null; replies: { by: string; text: string; at: string }[];
}
export type YpFeedbackInput = Partial<Pick<YpFeedbackView, "t" | "range" | "text" | "kind" | "sug" | "reaction">> & Pick<YpFeedbackView, "target" | "ver">;
export interface YpScheduleItem { project: YpProject; makeVersion: number; editDue: string; uploadPlan: string; log: { at: string; by: string; from: string; to: string; why: string; field?: string }[]; waiting: { gate: YpGate; requestedAt: string } | null }
export interface YpLegacyTopic { id: string; title: string; updatedAt: string; step: string; assigneeId: string | null }
export type YpAssetKind = "plan_thumb" | "thumb" | "final" | "srt" | "column";
export interface YpClient {
  list(): Promise<YpProject[]>;
  get(id: string): Promise<YpProject>;
  bundle(id: string): Promise<YpBundle>;
  create(input: YpTopicInput): Promise<YpProject>;
  update(id: string, expectedVersion: number, patch: YpTopicInput): Promise<YpProject>;
  topicGate(id: string, action: "confirm" | "request" | "cancel", expectedVersion: number, reply?: string): Promise<{ project: YpProject; created: YpProject[] }>;
  gate(id: string, gate: YpGate, action: "confirm" | "request" | "cancel", expectedVersion: number, reply?: string): Promise<{ project: YpProject; created: YpProject[] }>;
  saveStage<K extends YpStageKind>(id: string, kind: K, expectedVersion: number, patch: Record<string, unknown>): Promise<{ stage: YpStageView<K>; project: YpProject }>;
  /** One SEO 칼럼 to the MYIN 아티클: send (draft or update), publish, or back to draft. */
  columnMyin(id: string, item: string, action: "send" | "publish" | "unpublish", expectedVersion: number): Promise<{ stage: YpStageView<"column">; project: YpProject }>;
  move(id: string, to: "make" | "review" | "shorts" | "done", expectedVersion: number): Promise<YpProject>;
  uploadAsset(id: string, kind: YpAssetKind, file: File, onProgress?: (percent: number) => void): Promise<{ path: string; name: string; bytes: number }>;
  assetUrl(id: string, path: string): Promise<string>;
  finalUrl(id: string, final: YpFinalView): Promise<string | null>;
  feedback(id: string): Promise<YpFeedbackView[]>;
  addFeedback(id: string, input: YpFeedbackInput): Promise<YpFeedbackView>;
  actFeedback(id: string, itemId: string, expectedVersion: number, action: "resolve" | "reopen" | "decline" | "reply", text?: string): Promise<YpFeedbackView>;
  uploadSession(id: string, input: { fileName: string; fileSize: number; mimeType: string; connectionOwnerId?: string }): Promise<{ uploadUrl: string; finalV: number }>;
  uploadComplete(id: string, input: { videoId: string; connectionOwnerId?: string }): Promise<{ videoId: string; videoUrl: string; thumbnail: string }>;
  /** The 대표's decision on a waiting step, or a note on one the PD confirmed (note · memo). */
  confirm(id: string, gate: YpGate, action: YpApproverAction | "note", expectedVersion: number, extra?: YpConfirmExtra): Promise<YpProject>;
  confirmList(tab: "self" | "wait" | "done" | "hold" | "shorts"): Promise<{ project: YpProject; gate: YpGate }[]>;
  /** 쇼츠 확정 by the PD, or a comment on its record (owner decision 2026-10-25). */
  shorts(id: string, expectedVersion: number, input: { action: "confirm"; note?: string } | { action: "comment"; text: string }): Promise<YpProject>;
  members(): Promise<YpMember[]>;
  legacy(): Promise<YpLegacyTopic[]>;
  schedule(): Promise<YpScheduleItem[]>;
  moveDates(id: string, makeVersion: number, patch: { editDue?: string; uploadPlan?: string; why?: string }): Promise<void>;
  adopt(id: string): Promise<YpProject>;
  /** 영상 복제 (owner decision 2026-10-28): the same step (제작 at most), voice and video made again. */
  copy(id: string): Promise<YpProject>;
  /** 내 영상 휴지통 (staff request 2026-10-26): trash · restore by the maker, PD or an admin; 영구 삭제 by an admin after 30 days. */
  trashList(): Promise<(YpTrashed & { canManage: boolean })[]>;
  trash(id: string, expectedVersion: number, reason: string): Promise<void>;
  restore(id: string): Promise<void>;
  purge(id: string, reason: string): Promise<void>;
  short(id: string): Promise<YpShortView>;
  saveShort(id: string, expectedVersion: number, patch: YpShortPatch): Promise<YpShortView>;
  shortImage(id: string, file: File): Promise<{ assetId: string; url: string }>;
  renderShort(id: string, expectedVersion: number, voiceApproved: boolean, aspect?: "9:16" | "1:1" | "4:5"): Promise<void>;
  renderClip(id: string, clipId: string): Promise<void>;
  clipRenders(id: string): Promise<Record<string, YpRenderView>>;
  /** The project's 쇼츠 대본 (content_short), for the 쇼츠 컨펌 screen. */
  clips(id: string): Promise<OsRecord[]>;
  shortVideoUrl(id: string, renderId: string, download?: boolean): Promise<string>;
  /** [숏폼으로 만들기] on a longform's 숏폼 주제 후보: the new 숏폼's id and the candidates with the made one marked. */
  makeShort(id: string, topicId: string): Promise<{ projectId: string; topics: YpStageView<"shortTopics"> }>;
  /** The 대본 step's latest 레퍼런스 받기 (null before the first), and [레퍼런스 받기] itself. */
  shortRefs(id: string): Promise<YpShortRefFetch | null>;
  fetchShortRefs(id: string): Promise<YpShortRefFetch>;
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
    columnMyin: (id, item, action, expectedVersion) => apiRequest(`${base}/${id}/column/myin`, { token, method: "POST", body: json({ item, action, expectedVersion }) }),
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
    shorts: async (id, expectedVersion, input) => (await apiRequest<{ project: YpProject }>(`${base}/${id}/shorts`, { token, method: "POST", body: json({ ...input, expectedVersion }) })).project,
    legacy: async () => (await apiRequest<{ topics: YpLegacyTopic[] }>("/api/v1/content/youtube/legacy", { token })).topics,
    schedule: async () => (await apiRequest<{ items: YpScheduleItem[] }>("/api/v1/content/youtube/schedule", { token })).items,
    moveDates: async (id, makeVersion, patch) => { await apiRequest(`${base}/${id}/dates`, { token, method: "PATCH", body: json({ expectedVersion: makeVersion, ...patch }) }); },
    adopt: async id => (await apiRequest<{ project: YpProject }>("/api/v1/content/youtube/legacy", { token, method: "POST", body: json({ id }) })).project,
    copy: async id => (await apiRequest<{ project: YpProject }>(`${base}/${id}/copy`, { token, method: "POST", body: json({}) })).project,
    trashList: async () => (await apiRequest<{ items: (YpTrashed & { canManage: boolean })[] }>(`${base}/trash`, { token })).items,
    trash: async (id, expectedVersion, reason) => { await apiRequest(`${base}/${id}/trash`, { token, method: "POST", body: json({ action: "trash", expectedVersion, reason }) }); },
    restore: async id => { await apiRequest(`${base}/${id}/trash`, { token, method: "POST", body: json({ action: "restore" }) }); },
    purge: async (id, reason) => { await apiRequest(`${base}/${id}/trash`, { token, method: "POST", body: json({ action: "purge", reason, confirm: true }) }); },
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
    renderShort: async (id, expectedVersion, voiceApproved, aspect = "9:16") => { await apiRequest(`${base}/${id}/short`, { token, method: "POST", body: json({ action: "render", expectedVersion, voiceApproved, aspect }) }); },
    renderClip: async (id, clipId) => { await apiRequest(`${base}/${id}/short`, { token, method: "POST", body: json({ action: "clip", clipId }) }); },
    clipRenders: async id => (await apiRequest<{ clips: Record<string, YpRenderView> }>(`${base}/${id}/short?clips=1`, { token })).clips,
    clips: async id => (await listRecords(token, "content_short", `parentId=${id}&limit=200`)).records.filter(row => !row.archived_at),
    shortVideoUrl,
    makeShort: (id, topicId) => apiRequest(`${base}/${id}/short-topic`, { token, method: "POST", body: json({ topicId }) }),
    shortRefs: async id => (await apiRequest<{ refs: YpShortRefFetch | null }>(`${base}/${id}/short-refs`, { token })).refs,
    fetchShortRefs: async id => (await apiRequest<{ refs: YpShortRefFetch }>(`${base}/${id}/short-refs`, { token, method: "POST" })).refs,
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
let demoTrash: YpTrashed[] = [];
const demoProjects = () => demoStore ??= [
  demoProject("demo-p1", "[예시] 하루 일이 두 개뿐인데 저녁마다 지치는 이유", "anim", "topic", 0),
  selfDemo(demoProject("demo-p2", "[예시] 1인 창업 첫 달에 꼭 정해야 할 세 가지", "live", "draft", 1, "demo-logan")),
  demoProject("demo-p3", "[예시] 부업 수익을 세금 걱정 없이 정리하는 법", "live", "outline", 2),
  demoProject("demo-p4", "[예시] 퇴근 후 2시간 루틴 만들기", "anim", "make", 3, "demo-pd"),
  demoProject("demo-p5", "[예시] 강의 상세페이지 첫 화면 고치기", "live", "review", 5),
  demoProject("demo-p6", "[예시] 처음 쓰는 사업계획서의 순서", "anim", "upload", 8, "demo-logan"),
  shortsDemo(demoProject("demo-p7", "[예시] 고객 인터뷰 질문 다섯 개", "live", "done", 13)),
  waitingDemo(demoProject("demo-p8", "[예시] 구독자 1만 명 전에 할 일", "anim", "topic", 1, "demo-logan")),
  demoProject("demo-p9", "[예시] 강점 진단 결과지 30초 광고", "short", "make", 0),
  demoProject("demo-p10", "[예시] 일이 안 맞을 때 먼저 볼 4칸 (릴스)", "short", "upload", 1),
  demoProject("demo-p11", "[예시] 만나고 싶은데 쉬고도 싶다면", "short", "make", 0),
  demoProject("demo-p12", "[예시] 주말 약속 피곤함", "short", "topic", 0),
];
// 숏폼 made from a confirmed 대본 (2026-10-28) in the demo; demo-p9 keeps the older scene editor (made before the 대본 step).
const CONFIRMED_SHORT_DEMOS = ["demo-p10", "demo-p11"];
/** One example 쇼츠 확정 record with a 대표 comment, so 대표 메뉴 › 컨펌 › 쇼츠 확정 has something to show in the demo. */
function shortsDemo(project: YpProject): YpProject {
  const yp = shortsAction(project.yp, { action: "confirm", note: "[예시] 3편 확정", clips: [1, 2, 3].map(n => ({ id: `demo-clip-${n}`, title: `[예시] 쇼츠 ${n}`,
    metadata: { hook: "첫 문장", desc: "설명 #예시", segments: [{ start: n * 60, end: n * 60 + 40 }] } })) }, { id: "demo-logan", name: "로건" }, daysAgo(2));
  return { ...project, yp: shortsAction(yp, { action: "comment", text: "[예시] 2번 제목을 더 짧게 바꿔 주세요" }, { id: DEMO_ME, name: "리키" }, daysAgo(1)) };
}
/** One example topic the PD confirmed, so 대표 메뉴 › 컨펌 › PD 컨펌 has something to show in the demo. */
function selfDemo(project: YpProject): YpProject {
  const at = daysAgo(1);
  return { ...project, yp: { ...project.yp, gates: { ...project.yp.gates, topic: { state: "ok", round: 1, requestedAt: at, requestedBy: "demo-logan", decidedAt: at, decidedBy: "demo-logan", self: true } } } };
}
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
  const shortTopics = emptyStage("shortTopics", kind);
  if (at >= 2 && ["upload", "shorts", "done"].includes(project.yp.stage)) shortTopics.items = [
    { id: "st1", insight: "[예시] 지치는 건 일이 많아서가 아니라 고를 게 많아서", scene: "퇴근 뒤 소파에서 휴대폰만 보는 3년 차 마케터", paragraph: "본론 1 · 결정이 많다", why: "누구나 겪는 저녁 장면" },
    { id: "st2", insight: "[예시] 내 기준이 없으면 남의 순서로 하루를 산다", scene: "메일 순서대로 일하다 중요한 일을 못 한 날", paragraph: "본론 2 · 내 기준", why: "할 일 목록이 길수록 공감" }];
  // A 숏폼 past its 대본 has a confirmed one, so 제작 shows the automatic making (2026-10-28).
  const shortScript = emptyStage("shortScript", kind);
  if (at >= 2 && CONFIRMED_SHORT_DEMOS.includes(project.id)) {
    const text = "[예시] 친구는 만나고 싶은데 약속은 부담돼요.\n주말을 전부 약속으로 채우면 지치거든요.\n[관계] 만나고 싶은 마음과 쉬고 싶은 마음이 같이 있는 거예요.\n그래서 토요일 오후만 만나고 저녁엔 먼저 들어가요.";
    Object.assign(shortScript, { headCopy: "[예시] 만나고 싶은데 쉬고 싶다", text, confirmed: { at: daysAgo(1), text, headCopy: "[예시] 만나고 싶은데 쉬고 싶다" } });
  }
  // A 숏폼 at 주제 (2026-10-28) starts from a 초안 주제: its 참고 영상 are found and the staff AI's formulas and 주제 후보 wait for the PD.
  if (project.id === "demo-p12") shortScript.research = { by: "리키", model: "예시", at: daysAgo(0), jobId: "demo-job", picked: [], notes: "[예시] 두 영상 모두 첫 화면 큰 글자가 조건과 감정을 부딪치게 했어요.",
    formulas: [
      { name: "[예시] 좋은 조건, 반대 감정", head: "[좋은 조건]인데 [반대 감정]", cover: "[숫자] [조건]인데 [감정]", hook: "[좋은 조건]인데 [반대 감정]이라는 사연이 왔어요", flow: "사연 → 다들 하는 오해 → 진짜 이유 → 작은 해결 (2:2:4:2)", why: "좋은 조건과 반대 감정이 부딪혀 멈춰요", refs: [] },
      { name: "[예시] 체력 문제가 아니에요", head: "[흔한 장면]하는 진짜 이유", cover: "[장면]하는 이유", hook: "[흔한 장면]하면 끝이죠", flow: "장면 → 오해 부정 → 진짜 이유 → 바꾼 하루", why: "누구나 겪는 장면에서 오해를 뒤집어요", refs: [] }],
    topics: [
      { title: "[예시] 약속은 잡았는데 가기 싫을 때", insight: "만나고 싶은 마음과 쉬고 싶은 마음은 같이 있어도 돼요", formula: "[예시] 좋은 조건, 반대 감정", why: "약속을 잡고 나서 취소하고 싶어지는 날" },
      { title: "[예시] 주말 약속 뒤에 더 지치는 진짜 이유", insight: "지치는 건 사람 때문이 아니라 쉴 틈 없는 일정 때문이에요", formula: "[예시] 체력 문제가 아니에요", why: "주말이 끝나면 오히려 더 피곤한 장면" },
      { title: "[예시] 친구는 좋은데 약속은 부담될 때", insight: "부담은 친구가 아니라 약속의 개수에서 와요", formula: "[예시] 좋은 조건, 반대 감정", why: "좋은 사람과의 약속도 부담스러운 마음" }] };
  return { plan: { id: null, version: 0, data: plan }, outline: { id: null, version: 0, data: outline }, shortTopics: { id: null, version: 0, data: shortTopics }, make: { id: null, version: 0, data: emptyStage("make", kind) }, upload: { id: null, version: 0, data: emptyStage("upload", kind) },
    column: { id: null, version: 0, data: emptyStage("column", kind) },
    shortScript: { id: null, version: 0, data: shortScript } };
}
const demoStages = new Map<string, YpStagesView>();
const demoShorts = new Map<string, YpShortView>();
const demoShort = (project: YpProject): YpShortView => demoShorts.get(project.id) ?? { id: `demo-short-${project.id}`, version: 1, scenes: [], aiScenes: null, appeals: [], ai: null, images: {}, render: null,
  brief: { purpose: "organic", duration: 30, product: "", audience: project.yp.topic.target, goal: "", landingUrl: "", evidence: "", appeal: "" } };
const demoFinals = new Map<string, YpFinalView[]>();
const demoFeedback = new Map<string, YpFeedbackView[]>();
const demoFiles = new Map<string, string>();
/** The demo has no 영상 만드는 컴퓨터: [찾기] returns two example references at once (no images). */
function exampleRefs(id: string, query: string): YpShortRefFetch {
  const now = new Date().toISOString();
  const example = (n: number, title: string, views: number, transcript: string) => ({ url: `https://www.youtube.com/shorts/demo-${n}`, title, channel: "예시 채널", views, ratio: 12, source: "market" as const,
    result: { ok: true, durationSeconds: 40, transcript, thumb: false, sheet: false, error: "" }, thumbUrl: null, sheetUrl: null });
  return { id: `demo-refs-${id}`, status: "done", query, requestedAt: now, doneAt: now, error: null, items: [
    example(1, "[예시] 연봉 7천인데 그만두고 싶어요", 1_250_000, "0.0 [예시] 연봉 7천인데 그만두고 싶다는 사연이 왔어요\n2.6 조건은 좋은데 매일 지옥 같대요"),
    example(2, "[예시] 퇴근하면 아무것도 못 하는 이유", 640_000, "0.0 [예시] 퇴근하고 소파에 누우면 끝이죠\n2.1 체력 문제가 아니에요")] };
}
const demoRefs = new Map<string, YpShortRefFetch>([["demo-p12", exampleRefs("demo-p12", "주말 약속 피곤함")]]);
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
      const missing = name === "draft" ? project.yp.topic.type === "short" ? shortScriptMissing(stages.shortScript.data) : draftMissing(stages.plan.data) : (demoFinals.get(id) ?? []).length ? "" : "최종본을 올려주세요";
      if (missing) throw demoError(400, "GATE_INCOMPLETE", missing);
      const yp = gateApply(project, name, action, { actor: DEMO_ME, now, reply });
      if (name === "draft" && action === "confirm") { const stages = stagesOf(project); demoStages.set(id, { ...stages, plan: { ...stages.plan, data: { ...stages.plan.data, confirmed: confirmPlan(stages.plan.data, now) } } }); }
      return { project: bump(project, yp), created: [] };
    }
    const missing = topicMissing(project.title, project.yp.topic);
    if (missing) throw demoError(400, "TOPIC_INCOMPLETE", missing);
    const [first, ...rest] = topicLines(project.title).slice(0, YP_MAX_LINES);
    const saved = put({ ...project, title: first, version: project.version + 1, updatedAt: now, yp: gateApply(project, "topic", action, { actor: DEMO_ME, now, reply }) });
    const created = rest.map(line => {
      const extra = add(line, { kind: project.yp.topic.type, target: project.yp.topic.target, note: project.yp.topic.note, refs: project.yp.topic.refs, assigneeId: project.assigneeId }, project.id);
      return put({ ...extra, yp: gateApply(extra, "topic", action, { actor: DEMO_ME, now }) });
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
        const pair = p.pair as { slot: "A" | "B" | "C"; title: string; copy: string; reason: string } | undefined;
        if (pair) { const { slot, ...edit } = pair; const edits = { ...make.edits }; if (edit.title || edit.copy) edits[slot] = { ...edit, at: now, by: "리키" }; else delete edits[slot]; make.edits = edits; if (slot === "A") { make.aTitle = ""; make.aReason = ""; } }
        if (make.status !== "done" && (final || thumb) && (demoFinals.get(id) ?? []).length && !thumbsMissing(make)) make.status = "done";
        data = make as YpStageData[typeof kind];
      }
      if (kind === "column") {
        const { items } = current.data as YpStageData["column"]; const p = patch as { item?: string; html?: string; remove?: true; fill?: { slot: string; path?: string; url?: string; name?: string } };
        const change = (item: YpStageData["column"]["items"][number]) => {
          if (p.fill) { const { slot, ...fill } = p.fill; const fills = { ...item.fills }; if (fill.path || fill.url) fills[slot] = fill; else delete fills[slot]; return { ...item, fills }; }
          return typeof p.html === "string" ? { ...item, html: p.html } : item;
        };
        data = { items: !p.item ? [...items, { id: crypto.randomUUID().slice(0, 8), html: p.html ?? "", fills: {}, ai: null }]
          : p.remove ? items.filter(item => item.id !== p.item) : items.map(item => item.id === p.item ? change(item) : item) } as YpStageData[typeof kind];
      }
      const stage = { id: current.id ?? `demo-${kind}-${id}`, version: current.version + 1, data } as YpStageView<typeof kind>;
      demoStages.set(id, { ...stages, [kind]: stage });
      return structuredClone({ stage, project });
    },
    // The demo has no MYIN site: it records what MYIN would answer, with the production address shape.
    columnMyin: async (id, itemId, action, expectedVersion) => {
      const project = find(id);
      const stages = stagesOf(project);
      checkVersion(stages.column.version, expectedVersion);
      const now = new Date().toISOString();
      const items = stages.column.data.items.map(item => {
        if (item.id !== itemId) return item;
        if (action !== "send" && !item.myin) throw demoError(409, "MYIN_NOT_SENT", "먼저 마이인에 임시 글로 올려 주세요.");
        const slug = columnMeta(item.html).slug || "demo-column";
        const status = action === "send" ? item.myin?.status ?? "draft" : action === "publish" ? "published" : "draft";
        return { ...item, myin: { id: item.myin?.id ?? `demo-${item.id}`, slug, status, url: `https://www.myinlab.co.kr/articles/${slug}`, at: now, by: "리키",
          publishedAt: status === "published" ? item.myin?.publishedAt ?? now : null, sig: action === "send" ? columnSignature(item) : item.myin?.sig ?? "" } as const };
      });
      const stage = { ...stages.column, version: stages.column.version + 1, data: { items } };
      demoStages.set(id, { ...stages, column: stage });
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
      if (action === "note") return bump(project, { ...project.yp, notes: [...(project.yp.notes ?? []), { gate: gateName, at: now, by: DEMO_ME, name: "리키", text: extra.memo ?? "" }] });
      const next = bump(project, gateApply(project, gateName, action, { actor: DEMO_ME, now, ...extra }));
      if (gateName === "draft" && action === "ok") { const stages = stagesOf(project); demoStages.set(id, { ...stages, plan: { ...stages.plan, data: { ...stages.plan.data, confirmed: confirmPlan(stages.plan.data, now) } } }); }
      return next;
    },
    confirmList: async tab => confirmTab(structuredClone(demoProjects()), tab, DEMO_ME).map(row => ({ project: row.project, gate: row.gate })),
    shorts: async (id, expectedVersion, input) => {
      const project = find(id);
      checkVersion(project.version, expectedVersion);
      // The demo keeps no shorts scripts, so a 확정 answers like an empty pick; a comment is kept.
      try { return bump(project, shortsAction(project.yp, input.action === "confirm" ? { ...input, clips: [] } : input, { id: DEMO_ME, name: "리키" }, new Date().toISOString())); }
      catch (error) { throw error instanceof GateError ? demoError(error.status, error.code, error.message) : error; }
    },
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
    copy: async () => { throw demoError(409, "DEMO", "데모에서는 영상을 복제하지 않아요."); },
    trashList: async () => structuredClone(demoTrash.map(item => ({ ...item, canManage: true }))),
    trash: async (id, expectedVersion, reason) => {
      const project = find(id);
      checkVersion(project.version, expectedVersion);
      demoStore = demoProjects().filter(row => row.id !== id);
      demoTrash.unshift({ project, trash: { at: new Date().toISOString(), by: DEMO_ME, name: "리키", reason, stage: project.yp.stage } });
    },
    restore: async id => {
      const item = demoTrash.find(row => row.project.id === id);
      if (!item) throw demoError(404, "NOT_IN_TRASH", "휴지통에 없는 영상이에요.");
      demoTrash = demoTrash.filter(row => row !== item);
      demoStore = [item.project, ...demoProjects()];
    },
    purge: async id => {
      const item = demoTrash.find(row => row.project.id === id);
      if (!item) throw demoError(404, "NOT_IN_TRASH", "휴지통에 없는 영상이에요.");
      const left = trashDaysLeft(item.trash.at);
      if (left > 0) throw demoError(409, "PURGE_TOO_EARLY", `휴지통에 넣은 지 30일이 지나야 영구 삭제할 수 있어요. ${left}일 남았어요.`);
      demoTrash = demoTrash.filter(row => row !== item);
    },
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
    renderShort: async () => { throw demoError(409, "DEMO", "데모에서는 MP4를 만들지 않아요. 실제 화면에서 영상 만드는 컴퓨터가 만들어요."); },
    renderClip: async () => { throw demoError(409, "DEMO", "데모에서는 세로 영상을 만들지 않아요."); },
    clipRenders: async () => ({}),
    clips: async () => [],
    shortVideoUrl: async () => "",
    shortRefs: async id => structuredClone(demoRefs.get(id) ?? null),
    fetchShortRefs: async id => {
      const refs = exampleRefs(id, find(id).title);
      demoRefs.set(id, refs);
      return structuredClone(refs);
    },
    makeShort: async (id, topicId) => {
      const longform = find(id);
      const stages = stagesOf(longform);
      const topic = stages.shortTopics.data.items.find(item => item.id === topicId);
      if (!topic) throw demoError(404, "SHORT_TOPIC_NOT_FOUND", "그 주제 후보를 찾지 못했어요.");
      if (topic.made) return { projectId: topic.made.projectId, topics: structuredClone(stages.shortTopics) };
      const made = add(topic.insight, { kind: "short", target: longform.yp.topic.target, note: `롱폼 「${longform.title}」에서\n장면: ${topic.scene}` });
      put({ ...made, yp: { ...made.yp, shortFrom: { projectId: id, title: longform.title, topicId, scene: topic.scene, paragraph: topic.paragraph } } });
      const topics = { ...stages.shortTopics, version: stages.shortTopics.version + 1, data: { ...stages.shortTopics.data,
        items: stages.shortTopics.data.items.map(item => item.id === topicId ? { ...item, made: { projectId: made.id, at: new Date().toISOString(), by: "리키" } } : item) } };
      demoStages.set(id, { ...stages, shortTopics: topics });
      return { projectId: made.id, topics: structuredClone(topics) };
    },
  };
}

export function youtubeProcessClient(token: string | null, demo: boolean): YpClient | null {
  if (demo) return demoClient();
  return token ? apiClient(token) : null;
}

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
export const isConflict = (error: unknown) => error instanceof ApiRequestError && error.status === 409 && error.code === "RECORD_VERSION_CONFLICT";
