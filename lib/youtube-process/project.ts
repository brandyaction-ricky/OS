// 유튜브 공정 v1 project rules shared by the API, the screens and the demo store (지시서 6-2 · 8-1).
import { editableFields } from "./confirm.ts";
export type YpStage = "topic" | "draft" | "outline" | "make" | "review" | "upload" | "shorts" | "done";
export type YpKind = "live" | "anim" | "short";
export type YpGate = "topic" | "draft" | "review" | "shorts";
export type YpGateState = "none" | "wait" | "changes" | "hold" | "ok";
export interface YpGateInfo { state: YpGateState; round: number; requestedAt?: string; requestedBy?: string; decidedAt?: string; decidedBy?: string; fields?: string[]; memo?: string; reason?: string }
export interface YpRef { url: string; videoId?: string; title?: string }
export interface YpTopic { type: YpKind | null; target: string; note: string; refs: YpRef[] }
export interface YpMeta {
  v: 1; stage: YpStage; topic: YpTopic; gates: Record<YpGate, YpGateInfo>; contentUpdatedAt: string; multiFrom?: string;
  /** 쇼츠 확정 by the PD (owner decision 2026-10-25): each confirmed clip's script as it was confirmed (clipSignature); a later change needs a new 확정. */
  shortsConfirmed?: { at: string; by: string; clips: Record<string, string> };
  /** 쇼츠 확정 · 코멘트 기록, newest last: the 대표 reads it in 대표 메뉴 › 컨펌 and comments when something should change. */
  shortsLog?: YpShortsLogEntry[];
}
export interface YpShortsLogEntry { at: string; by: string; byName: string; kind: "confirm" | "comment"; text: string; count?: number }
export interface YpProject { id: string; version: number; title: string; assigneeId: string | null; ownerId: string; updatedAt: string; yp: YpMeta }

export const YP_FLOW = ["주제", "기획안", "구성안", "제작", "최종 검수", "업로드", "쇼츠 · 칼럼"] as const;
export const YP_STAGE_INDEX: Record<YpStage, number> = { topic: 0, draft: 1, outline: 2, make: 3, review: 4, upload: 5, shorts: 6, done: 7 };
export const YP_KIND_LABEL: Record<YpKind, string> = { live: "롱폼 실사 촬영", anim: "롱폼 애니메이션", short: "숏폼 (릴스 · 광고)" };
export const YP_KIND_SHORT: Record<YpKind, string> = { live: "실사", anim: "애니메이션", short: "숏폼" };
/**
 * The steps a project goes through (index into YP_FLOW and the name shown). A 숏폼 (owner decision 2026-10-21) has no
 * 기획안 · 구성안 — what to make and the scenes sit in 제작 — and ends with 내보내기 instead of the YouTube upload and 쇼츠.
 */
export function flowOf(kind: YpKind | null) {
  return kind === "short" ? [{ index: 0, name: "주제" }, { index: 3, name: "제작" }, { index: 4, name: "최종 검수" }, { index: 5, name: "내보내기" }]
    : YP_FLOW.map((name, index) => ({ index, name: name as string }));
}
export const stepName = (index: number, kind: YpKind | null) => flowOf(kind).find(step => step.index === index)?.name ?? YP_FLOW[index] ?? "완료";
export const YP_MAX_LINES = 20;
export const YP_RECENT = 6;

export function topicLines(title: string) {
  return title.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

/** The one-line reason the topic confirm request is not ready, or "" (시안 topicMissing). */
export function topicMissing(title: string, topic: Pick<YpTopic, "type" | "target">) {
  const lines = topicLines(title);
  if (!lines.length) return "주제를 써주세요";
  if (lines.length > YP_MAX_LINES) return `주제는 한 번에 ${YP_MAX_LINES}줄까지 보낼 수 있어요`;
  if (!topic.type) return "유형을 골라주세요";
  if (!topic.target.trim()) return "정밀 타겟을 써주세요";
  return "";
}

export function emptyGates(): Record<YpGate, YpGateInfo> {
  return { topic: { state: "none", round: 0 }, draft: { state: "none", round: 0 }, review: { state: "none", round: 0 }, shorts: { state: "none", round: 0 } };
}

export function newProjectMeta(topic: YpTopic, now: string, multiFrom?: string) {
  const yp: YpMeta = { v: 1, stage: "topic", topic, gates: emptyGates(), contentUpdatedAt: now, ...(multiFrom ? { multiFrom } : {}) };
  return { workflow: "youtube_v1" as const, yp };
}

type ProjectRow = { id: string; version: number; title: string; assignee_id?: string | null; owner_id: string; updated_at: string; metadata?: Record<string, unknown> | null };
export function projectFromRecord(row: ProjectRow): YpProject | null {
  const yp = row.metadata?.yp as YpMeta | undefined;
  if (row.metadata?.workflow !== "youtube_v1" || yp?.v !== 1) return null;
  // Projects made before a gate existed (쇼츠 컨펌, 2026-10-25) read it as not yet requested.
  return { id: row.id, version: row.version, title: row.title, assigneeId: row.assignee_id ?? null, ownerId: row.owner_id, updatedAt: row.updated_at, yp: { ...yp, gates: { ...emptyGates(), ...yp.gates } } };
}

/** Project name = first topic line (4-2); stays as the record title. */
export const projectName = (project: Pick<YpProject, "title">) => topicLines(project.title)[0] ?? "새 프로젝트";

/** Some topic field can change: while writing, on hold, or the fields ticked in 수정 요청 (8-1, editableFields). */
export function topicEditable(project: Pick<YpProject, "yp">) {
  const fields = editableFields(project, "topic");
  return fields === "all" || fields.length > 0;
}
/** Topic edit keys (API and form) and the field keys the approver ticks. */
export const TOPIC_FIELD_OF = { title: "topic.title", kind: "topic.type", target: "topic.target", refs: "topic.refs", note: "topic.note" } as const;
export function topicFieldEditable(project: Pick<YpProject, "yp">, key: keyof typeof TOPIC_FIELD_OF) {
  const fields = editableFields(project, "topic");
  return fields === "all" || fields.includes(TOPIC_FIELD_OF[key]);
}

export function recentProjects<T extends Pick<YpProject, "yp">>(projects: T[], limit = YP_RECENT) {
  return [...projects].sort((a, b) => b.yp.contentUpdatedAt.localeCompare(a.yp.contentUpdatedAt)).slice(0, limit);
}

export function searchProjects<T extends Pick<YpProject, "title">>(projects: T[], query: string) {
  const q = query.trim().toLocaleLowerCase("ko-KR");
  return q ? projects.filter(project => project.title.toLocaleLowerCase("ko-KR").includes(q)) : projects;
}

// Bracketed labels such as [예시] or [시험] are not topic words.
const words = (text: string) => new Set(text.replace(/\[[^\]]*\]/g, " ").toLocaleLowerCase("ko-KR").split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 2));
/** Earlier projects sharing words with the topic's first line (keyword match, not AI). Most shared words first. */
export function similarProjects<T extends Pick<YpProject, "id" | "title">>(title: string, projects: T[], selfId?: string, limit = 3) {
  const mine = words(topicLines(title)[0] ?? "");
  if (!mine.size) return [];
  return projects
    .filter(project => project.id !== selfId)
    .map(project => ({ project, shared: [...words(projectName(project))].filter(word => mine.has(word)).length }))
    .filter(hit => hit.shared > 0)
    .sort((a, b) => b.shared - a.shared)
    .slice(0, limit)
    .map(hit => hit.project);
}

/** A YouTube watch, short or youtu.be link, normalized; null for anything else. */
export function parseYoutubeRef(input: string): YpRef | null {
  let url: URL;
  try { url = new URL(input.trim()); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^(www|m)\./, "");
  const id = host === "youtu.be" ? url.pathname.slice(1)
    : host === "youtube.com" ? (url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/(?:shorts|live)\/([^/]+)/)?.[1]) : null;
  if (!id || !/^[\w-]{11}$/.test(id)) return null;
  return { url: `https://www.youtube.com/watch?v=${id}`, videoId: id };
}

/** Projects are saved only through the 유튜브 공정 API, never through the generic records API (6-5). */
export function protectedYoutubeChange(current: Record<string, unknown> | null | undefined, proposed: Record<string, unknown> | null | undefined) {
  return current?.workflow === "youtube_v1" || proposed?.workflow === "youtube_v1";
}

const PLAN_VIEWS = ["topic", "draft", "outline"] as const;
/** Screen for flow step i (0 주제 … 6 쇼츠) of a project. */
export function stepHref(index: number, id: string) {
  if (index <= 2) return `/content/plan?project=${encodeURIComponent(id)}&view=${PLAN_VIEWS[index]}`;
  return [`/content/make?project=${encodeURIComponent(id)}`, `/content/final-check?project=${encodeURIComponent(id)}&tab=video`, `/content/upload?project=${encodeURIComponent(id)}`, `/content/shorts?project=${encodeURIComponent(id)}`][index - 3];
}
/** Where a project row opens: its current step (a finished project opens its topic). */
export const projectHref = (project: Pick<YpProject, "id" | "yp">) => stepHref(project.yp.stage === "done" ? 0 : YP_STAGE_INDEX[project.yp.stage], project.id);
export const stageLabel = (project: Pick<YpProject, "yp">) => project.yp.stage === "done" ? "완료" : stepName(YP_STAGE_INDEX[project.yp.stage], project.yp.topic.type);
