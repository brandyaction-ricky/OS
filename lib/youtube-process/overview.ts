// 한눈에 보기 (리키 관제실 시안 v0.1 P1, owner decision 2026-10-31: its own menu, an everyday name): every piece of content work
// that is still open — people's steps and the jobs handed to staff AI — in one list, sorted by what it needs now. Colour is for
// state only (결정 = warning · AI = purple · 막힘 = danger · 끝 = mint); the channel is written out.
import type { TopicPlatform } from "../content-platforms.ts";
import { gateName } from "./confirm.ts";
import { nextAction } from "./next.ts";
import { projectName, type YpGate, type YpProject } from "./project.ts";

export type OvState = "decide" | "ai" | "blocked" | "human" | "wait";
export const OV_STATES: { state: OvState; label: string; sub: string }[] = [
  { state: "decide", label: "내 결정 필요", sub: "고르면 그 일이 이어져요" },
  { state: "ai", label: "AI 일하는 중", sub: "맡긴 일" },
  { state: "blocked", label: "막힘", sub: "다시 맡기거나 고쳐야 해요" },
  { state: "human", label: "사람 작업 중", sub: "담당자 차례" },
  { state: "wait", label: "대기 · 보류", sub: "다른 사람 컨펌이나 보류" },
];
/** 결론 먼저 (시안 P2): what the staff AI wrote on top of its result. */
export interface OvReport { conclusion: string; did: string[]; evidence: string[]; canon?: string }
/** An open staff-AI job on a video, or a result that arrived with a report and nobody took yet, as the overview API sends it (never the lease). */
export interface OvJob {
  sourceId: string; task: string; status: "backlog" | "active" | "blocked" | "done"; requestedAt: string; claimedAt: string | null; failReason: string | null;
  id?: string; ownerId?: string; doneAt?: string | null; report?: OvReport | null;
}
/** A Threads post from the content automation list (personal records). */
export interface OvThread { id: string; title: string; status: string; updatedAt: string }
export interface OvRow {
  id: string; channel: TopicPlatform; title: string; stage: string; assigneeId: string | null; state: OvState;
  /** The one line under the title: what is happening now. */
  now: string; since: string | null; href: string; gate?: YpGate; job?: OvJob;
}
export interface OvDecision { at: string; title: string; what: string; href: string }

// content-platforms projectPlatform, kept here because that module pulls server-only code into the unit tests.
const platformOf = (topic: YpProject["yp"]["topic"]): TopicPlatform => topic.type === "card" ? "card" : topic.type === "short" ? (topic.purpose === "ad" ? "ad" : "short") : "longform";
const GATE_OF: Partial<Record<YpProject["yp"]["stage"], YpGate>> = { topic: "topic", draft: "draft", review: "review" };
const minutes = (from: string, now: number) => Math.max(0, Math.round((now - Date.parse(from)) / 60_000));
/** "4분째" · "3시간째" · "2일째". */
export function elapsed(from: string, now: number) {
  const m = minutes(from, now);
  return m < 60 ? `${m}분째` : m < 1440 ? `${Math.floor(m / 60)}시간째` : `${Math.floor(m / 1440)}일째`;
}
const movedOn = (project: YpProject | undefined, doneAt?: string | null) => !project || !doneAt
  || Object.values(project.yp.gates).some(gate => (gate.requestedAt ?? "") > doneAt || (gate.decidedAt ?? "") > doneAt);
const RANK = { active: 0, backlog: 1, blocked: 2, done: 3 } as const;

/**
 * Which group each open video falls in. A waiting step is my decision when I am the approver or the video's PD (the PD confirms,
 * owner decision 2026-10-26); otherwise it waits on someone else. A blocked AI job comes first so it is not missed. An AI result that
 * arrived with a report is the decision of whoever sent the job or the PD, until someone takes it or the video moves on past it.
 */
export function overviewRows(projects: YpProject[], jobs: OvJob[], me: { id: string; canConfirm: boolean }, now = Date.now(), threads: OvThread[] = []) {
  const jobOf = new Map<string, OvJob>();
  for (const job of jobs) {
    // A result is old news once a step was asked for or decided after it arrived.
    if (job.status === "done" && movedOn(projects.find(project => project.id === job.sourceId), job.doneAt)) continue;
    const seen = jobOf.get(job.sourceId); if (!seen || RANK[job.status] < RANK[seen.status]) jobOf.set(job.sourceId, job);
  }
  const rows: OvRow[] = [];
  let done = 0;
  for (const project of projects) {
    if (project.yp.stage === "done") { done += 1; continue; }
    const next = nextAction(project);
    const gate = GATE_OF[project.yp.stage];
    const info = gate ? project.yp.gates[gate] : undefined;
    const job = jobOf.get(project.id);
    const base = { id: project.id, channel: platformOf(project.yp.topic), title: projectName(project), stage: `${Math.min(next.step + 1, next.total)}/${next.total} · ${next.stepName}`,
      assigneeId: project.assigneeId, href: next.href, ...(gate ? { gate } : {}), ...(job ? { job } : {}) };
    if (job?.status === "blocked") rows.push({ ...base, state: "blocked", now: `${job.task} · 막힘${job.failReason ? ` · ${job.failReason}` : ""}`, since: job.requestedAt });
    else if (gate && info?.state === "wait") {
      const mine = me.canConfirm || project.assigneeId === me.id;
      rows.push({ ...base, state: mine ? "decide" : "wait", now: `${gateName(gate, project.yp.topic.type)}${mine ? "" : " 대기"} · ${info.requestedAt ? elapsed(info.requestedAt, now) : ""}`.replace(/ · $/, ""), since: info.requestedAt ?? null });
    }
    else if (job?.status === "done") {
      const mine = job.ownerId === me.id || project.assigneeId === me.id;
      rows.push({ ...base, state: mine ? "decide" : "human", now: `AI 결과 도착 · ${job.task}${mine ? "" : " · 담당자 확인 중"}`, since: job.doneAt ?? job.requestedAt });
    }
    else if (job) rows.push({ ...base, state: "ai", now: job.status === "active" ? `${job.task} · ${elapsed(job.claimedAt ?? job.requestedAt, now)}` : `${job.task} · AI가 가져가기를 기다려요`, since: job.claimedAt ?? job.requestedAt });
    else if (next.tone === "hold") rows.push({ ...base, state: "wait", now: next.text, since: info?.decidedAt ?? null });
    else rows.push({ ...base, state: "human", now: next.tone === "fix" ? next.text : `다음: ${next.button}`, since: project.yp.contentUpdatedAt });
  }
  for (const item of threads) {
    if (item.status === "published") { done += 1; continue; }
    const state: OvState = item.status === "review" || item.status === "arrived" ? "decide" : item.status === "ai" ? "ai" : item.status === "ready" || item.status === "scheduled" ? "wait" : "human";
    const now = { review: "최종 확인 · 다섯 가지 직접 확인", arrived: "AI 결과 도착", ai: "AI 작업 중", ready: "발행 준비", scheduled: "게시 예정", blocked: "고칠 것", changes: "고칠 것" }[item.status] ?? "다음: 쓰레드 쓰기";
    rows.push({ id: item.id, channel: "threads", title: item.title || "제목 없는 글", stage: "스레드", assigneeId: null, state, now, since: item.updatedAt,
      href: item.status === "review" ? "/automation/review" : "/automation/threads" });
  }
  // Oldest first inside a group: what has waited longest is read first.
  rows.sort((a, b) => OV_STATES.findIndex(s => s.state === a.state) - OV_STATES.findIndex(s => s.state === b.state) || (a.since ?? "9999").localeCompare(b.since ?? "9999"));
  return { rows, done };
}

/** 오늘 내린 결정: steps confirmed, sent back or held today (KST), newest first. */
export function decisionsToday(projects: YpProject[], now = Date.now()) {
  const day = (value: number) => new Date(value + 9 * 3_600_000).toISOString().slice(0, 10);
  const today = day(now);
  const RESULT: Record<string, string> = { ok: "컨펌", changes: "수정 요청", hold: "보류" };
  const list: OvDecision[] = [];
  for (const project of projects) for (const gate of ["topic", "draft", "review"] as YpGate[]) {
    const info = project.yp.gates[gate];
    if (!info?.decidedAt || !RESULT[info.state] || day(Date.parse(info.decidedAt)) !== today) continue;
    list.push({ at: info.decidedAt, title: projectName(project), what: `${gateName(gate, project.yp.topic.type)} → ${RESULT[info.state]}${info.self ? " (PD)" : ""}`, href: nextAction(project).href });
  }
  return list.sort((a, b) => b.at.localeCompare(a.at));
}

/** The side-menu badges: decisions and AI jobs per platform, nothing when there is no work. */
export function overviewCounts(rows: OvRow[]) {
  const by: Partial<Record<TopicPlatform, { decide: number; ai: number }>> = {};
  for (const row of rows) {
    if (row.state !== "decide" && row.state !== "ai") continue;
    const slot = by[row.channel] ??= { decide: 0, ai: 0 };
    slot[row.state] += 1;
  }
  return { decide: rows.filter(row => row.state === "decide").length, ai: rows.filter(row => row.state === "ai").length, by };
}
