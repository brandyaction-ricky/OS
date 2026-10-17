"use client";

import { apiRequest, ApiRequestError, listMembers } from "@/lib/api-client";
import { newProjectMeta, topicEditable, topicLines, topicMissing, YP_MAX_LINES, type YpKind, type YpProject, type YpRef } from "@/lib/youtube-process/project";

export interface YpMember { id: string; name: string }
export interface YpTopicInput { title?: string; kind?: YpKind | null; target?: string; note?: string; refs?: YpRef[]; assigneeId?: string | null }
export interface YpClient {
  list(): Promise<YpProject[]>;
  get(id: string): Promise<YpProject>;
  create(input: YpTopicInput): Promise<YpProject>;
  update(id: string, expectedVersion: number, patch: YpTopicInput): Promise<YpProject>;
  topicGate(id: string, action: "request" | "cancel", expectedVersion: number): Promise<{ project: YpProject; created: YpProject[] }>;
  members(): Promise<YpMember[]>;
}

const json = (body: unknown) => JSON.stringify(body);

function apiClient(token: string): YpClient {
  const base = "/api/v1/content/youtube/projects";
  return {
    list: async () => (await apiRequest<{ projects: YpProject[] }>(base, { token })).projects,
    get: async id => (await apiRequest<{ project: YpProject }>(`${base}/${id}`, { token })).project,
    create: async input => (await apiRequest<{ project: YpProject }>(base, { token, method: "POST", body: json(input) })).project,
    update: async (id, expectedVersion, patch) => (await apiRequest<{ project: YpProject }>(`${base}/${id}`, { token, method: "PATCH", body: json({ ...patch, expectedVersion }) })).project,
    topicGate: (id, action, expectedVersion) => apiRequest(`${base}/${id}/gates/topic`, { token, method: "POST", body: json({ action, expectedVersion }) }),
    members: async () => (await listMembers(token)).members
      .filter(member => member.is_active && !member.is_shared_account && member.member_kind !== "partner")
      .map(member => ({ id: member.id, name: member.display_name })),
  };
}

// The demo has no database; this in-memory store follows the same rules as lib/server/youtube-process.ts.
const DEMO_ME = "demo-ricky";
const DEMO_MEMBERS: YpMember[] = [{ id: DEMO_ME, name: "리키" }, { id: "demo-logan", name: "로건" }, { id: "demo-pd", name: "예시 PD" }];
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
function demoProject(id: string, title: string, kind: YpKind, stage: YpProject["yp"]["stage"], days: number, assigneeId = DEMO_ME): YpProject {
  const meta = newProjectMeta({ type: kind, target: "퇴근 후 2시간 안에서 무엇부터 할지 막힌 30대 직장인", note: "", refs: [] }, daysAgo(days));
  if (stage !== "topic") meta.yp.gates.topic = { state: "ok", round: 1 };
  if (!["topic", "draft"].includes(stage)) meta.yp.gates.draft = { state: "ok", round: 1 };
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
];
const demoError = (status: number, code: string, message: string) => new ApiRequestError(message, code, status);
function demoClient(): YpClient {
  const find = (id: string) => {
    const project = demoProjects().find(row => row.id === id);
    if (!project) throw demoError(404, "YOUTUBE_PROJECT_NOT_FOUND", "프로젝트를 찾지 못했습니다.");
    return project;
  };
  const put = (next: YpProject) => { demoStore = demoProjects().map(row => row.id === next.id ? next : row); return structuredClone(next); };
  const add = (title: string, input: YpTopicInput, multiFrom?: string) => {
    const now = new Date().toISOString();
    const meta = newProjectMeta({ type: input.kind ?? null, target: input.target ?? "", note: input.note ?? "", refs: input.refs ?? [] }, now, multiFrom);
    const project: YpProject = { id: `demo-${crypto.randomUUID()}`, version: 1, title, assigneeId: input.assigneeId ?? DEMO_ME, ownerId: DEMO_ME, updatedAt: now, yp: meta.yp };
    demoStore = [project, ...demoProjects()];
    return project;
  };
  const checkVersion = (project: YpProject, expected: number) => {
    if (project.version !== expected) throw demoError(409, "RECORD_VERSION_CONFLICT", "다른 사람이 먼저 고쳤어요. 새로 불러와 주세요.");
  };
  return {
    list: async () => structuredClone(demoProjects()),
    get: async id => structuredClone(find(id)),
    create: async input => structuredClone(add(input.title ?? "", input)),
    update: async (id, expectedVersion, { assigneeId, ...fields }) => {
      const project = find(id);
      checkVersion(project, expectedVersion);
      const content = Object.keys(fields).length > 0;
      if (content && !topicEditable(project)) throw demoError(409, "GATE_WAITING", "대표 컨펌을 기다리는 중이라 고칠 수 없어요. 요청을 취소하면 고칠 수 있어요.");
      const topic = project.yp.topic;
      return put({
        ...project, version: project.version + 1, updatedAt: new Date().toISOString(),
        title: fields.title ?? project.title, assigneeId: assigneeId !== undefined ? assigneeId : project.assigneeId,
        yp: content ? { ...project.yp, contentUpdatedAt: new Date().toISOString(), topic: { type: fields.kind !== undefined ? fields.kind : topic.type, target: fields.target ?? topic.target, note: fields.note ?? topic.note, refs: fields.refs ?? topic.refs } } : project.yp,
      });
    },
    topicGate: async (id, action, expectedVersion) => {
      const project = find(id);
      checkVersion(project, expectedVersion);
      const gate = project.yp.gates.topic;
      const now = new Date().toISOString();
      const bump = (yp: YpProject["yp"], title = project.title) => ({ ...project, title, version: project.version + 1, updatedAt: now, yp });
      if (action === "cancel") {
        if (gate.state !== "wait") throw demoError(409, "INVALID_TRANSITION", "기다리는 컨펌 요청이 없어요.");
        return { project: put(bump({ ...project.yp, gates: { ...project.yp.gates, topic: { state: "none", round: gate.round } } })), created: [] };
      }
      const missing = topicMissing(project.title, project.yp.topic);
      if (!topicEditable(project) || missing) throw demoError(400, "TOPIC_INCOMPLETE", missing || "이미 대표 컨펌을 기다리고 있어요.");
      const [first, ...rest] = topicLines(project.title).slice(0, YP_MAX_LINES);
      const waiting = (round: number) => ({ state: "wait" as const, round, requestedAt: now, requestedBy: DEMO_ME });
      const saved = put(bump({ ...project.yp, gates: { ...project.yp.gates, topic: waiting(gate.round + 1) } }, first));
      const created = rest.map(line => {
        const extra = add(line, { kind: project.yp.topic.type, target: project.yp.topic.target, note: project.yp.topic.note, refs: project.yp.topic.refs, assigneeId: project.assigneeId }, project.id);
        return put({ ...extra, yp: { ...extra.yp, gates: { ...extra.yp.gates, topic: waiting(1) } } });
      });
      return { project: saved, created };
    },
    members: async () => DEMO_MEMBERS,
  };
}

export function youtubeProcessClient(token: string | null, demo: boolean): YpClient | null {
  if (demo) return demoClient();
  return token ? apiClient(token) : null;
}

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
export const isConflict = (error: unknown) => error instanceof ApiRequestError && error.status === 409 && error.code === "RECORD_VERSION_CONFLICT";
