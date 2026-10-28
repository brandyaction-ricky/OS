// 유튜브 공정 v1 confirm rules (지시서 8장): who may move a gate, to where, and what the PD may edit meanwhile.
import type { YpGate, YpGateInfo, YpMeta, YpProject, YpStage } from "./project";

export const GATE_NAME: Record<YpGate, string> = { topic: "주제 컨펌", draft: "기획안 컨펌", review: "최종 검토 컨펌", shorts: "쇼츠 확정" };
/** A 숏폼's 기획안 place is its 대본, and its topic is fixed from the references' formulas (주제 확정, 2026-10-28). */
export const gateName = (gate: YpGate, kind: YpProject["yp"]["topic"]["type"]) =>
  kind === "short" && gate === "draft" ? "대본 확정" : kind === "short" && gate === "topic" ? "주제 확정" : GATE_NAME[gate];
// 쇼츠 확정 (owner decision 2026-10-25): the PD confirms the shorts scripts; the 대표 only reads the record and comments. The gate
// keeps who confirmed and when (state ok); it is never requested or waited on, so the wait · hold lists and reminders never show it.
const GATE_STAGE: Record<YpGate, YpStage> = { topic: "topic", draft: "draft", review: "review", shorts: "shorts" };
const NEXT_STAGE: Record<YpGate, YpStage> = { topic: "draft", draft: "outline", review: "upload", shorts: "shorts" };
/** A 숏폼 has no 구성안: its 대본 확정 opens 제작. */
const nextStage = (gate: YpGate, yp: YpMeta): YpStage => gate === "draft" && yp.topic.type === "short" ? "make" : NEXT_STAGE[gate];
/** Fields the approver can tick in 수정 요청, per gate (S10-1). */
export const GATE_FIELDS: Record<YpGate, Record<string, string>> = {
  topic: { "topic.title": "주제", "topic.type": "유형", "topic.target": "정밀 타겟", "topic.refs": "참고 영상", "topic.note": "전달 사항" },
  draft: { "draft.tt": "제목 · 썸네일", "draft.opening": "오프닝", "draft.body": "본론", "draft.closing": "클로징 · 다음 행동", "draft.note": "전달 사항 · 참고 영상" },
  review: { "make.final": "최종본", "make.thumbs": "최종 썸네일" },
  shorts: { "shorts.pick": "고른 쇼츠", "shorts.parts": "구간 · 첫 3초", "shorts.copy": "제목 · 설명" },
};
export type YpPdAction = "request" | "cancel" | "confirm";
export type YpApproverAction = "ok" | "changes" | "hold" | "revert";
export interface YpGateInput { actor: string; now: string; fields?: string[]; memo?: string; reason?: string; reply?: string }

export class GateError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 409) { super(message); this.code = code; this.status = status; }
}

// ── Reminders (3차 결정 1): every 6 hours, never 22:00–08:00 Asia/Seoul; quiet-hour reminders wait for 08:00. ──
const KST = 9 * 3_600_000;
const kstHour = (ms: number) => new Date(ms + KST).getUTCHours();
export const quietHours = (iso: string) => { const hour = kstHour(Date.parse(iso)); return hour >= 22 || hour < 8; };
/** The next 08:00 KST at or after a quiet-hour moment. */
function nextEight(ms: number) {
  const local = new Date(ms + KST);
  const eight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 8) - KST;
  return eight >= ms ? eight : eight + 86_400_000;
}
/** When to remind next after a reminder (or a request) at `fromIso`. */
export function nextRemindAt(fromIso: string) {
  const at = Date.parse(fromIso) + 6 * 3_600_000;
  return new Date(quietHours(new Date(at).toISOString()) ? nextEight(at) : at).toISOString();
}
/** A request during quiet hours sends nothing now and is first announced at 08:00. */
export function firstRemindAt(requestIso: string) {
  return quietHours(requestIso) ? new Date(nextEight(Date.parse(requestIso))).toISOString() : nextRemindAt(requestIso);
}

/**
 * Which fields the PD may change now: every field until the step is confirmed (owner decision 2026-10-26 — the PD confirms; and staff
 * feedback the same day — a 수정 요청 opens every field, since a new topic moves the target and references with it). The ticked
 * fields of a 수정 요청 stay as a hint (고칠 칸), not a lock.
 */
export function editableFields(project: Pick<YpProject, "yp">, gate: YpGate): string[] | "all" {
  const info = project.yp.gates[gate];
  if (project.yp.stage !== GATE_STAGE[gate]) return [];
  return info.state === "ok" ? [] : "all";
}
/** True when the PD changed the content after the last decision (an unchanged re-request needs a reason, S11-5). */
export const editedSinceDecision = (project: Pick<YpProject, "yp">, gate: YpGate) => {
  const decided = project.yp.gates[gate].decidedAt;
  return !decided || project.yp.contentUpdatedAt > decided;
};

type Prev = Pick<YpGateInfo, "state" | "fields" | "memo" | "reason">;
type GateState = YpGateInfo & { prev?: Prev; remindAt?: string; pdReply?: string; revertedFrom?: YpStage };

/** The new project state after a PD or approver action; throws GateError for anything the table in 8-1 does not allow. */
export function applyGateAction(project: Pick<YpProject, "yp">, gate: YpGate, action: YpPdAction | YpApproverAction, input: YpGateInput): YpMeta {
  const yp = project.yp;
  const info = yp.gates[gate] as GateState;
  const put = (next: GateState, stage: YpStage = yp.stage): YpMeta => ({ ...yp, stage, gates: { ...yp.gates, [gate]: next } });
  const waitingNeeded = () => { if (info.state !== "wait") throw new GateError("INVALID_TRANSITION", "대표 컨펌을 기다리는 요청이 없어요."); };
  switch (action) {
    case "request": {
      if (yp.stage !== GATE_STAGE[gate] || !["none", "changes", "hold"].includes(info.state)) throw new GateError("INVALID_TRANSITION", info.state === "wait" ? "이미 대표 컨펌을 기다리고 있어요." : "지금은 이 컨펌을 요청할 수 없어요.");
      const reply = input.reply?.trim();
      if (info.state === "changes" && !editedSinceDecision(project, gate) && !reply) throw new GateError("REPLY_REQUIRED", "고친 칸이 없어요. 다시 요청하는 이유를 한 줄 써 주세요.", 400);
      return put({ state: "wait", round: info.round + 1, requestedAt: input.now, requestedBy: input.actor, remindAt: firstRemindAt(input.now),
        prev: { state: info.state, fields: info.fields, memo: info.memo, reason: info.reason }, ...(reply ? { pdReply: reply.slice(0, 200) } : {}),
        ...(info.revertedFrom ? { revertedFrom: info.revertedFrom } : {}) });
    }
    case "confirm": {
      // The PD's own confirm: from writing, a 수정 요청 or 보류, or a request still waiting from before (or a step the 대표 sent back).
      if (gate === "shorts" || yp.stage !== GATE_STAGE[gate] || info.state === "ok") throw new GateError("INVALID_TRANSITION", "지금은 이 단계를 컨펌할 수 없어요.");
      return put({ state: "ok", round: info.round + 1, requestedAt: input.now, requestedBy: input.actor, decidedAt: input.now, decidedBy: input.actor, self: true },
        info.revertedFrom ?? nextStage(gate, yp));
    }
    case "cancel": {
      waitingNeeded();
      if (info.revertedFrom && !info.prev) throw new GateError("INVALID_TRANSITION", "대표가 되돌린 결정은 PD가 취소할 수 없어요.");
      const prev = info.prev ?? { state: "none" as const };
      return put({ state: prev.state, round: info.round, ...(prev.fields ? { fields: prev.fields } : {}), ...(prev.memo ? { memo: prev.memo } : {}), ...(prev.reason ? { reason: prev.reason } : {}),
        decidedAt: info.decidedAt, decidedBy: info.decidedBy, ...(info.revertedFrom ? { revertedFrom: info.revertedFrom } : {}) });
    }
    case "ok":
      waitingNeeded();
      // A decision taken back (revert) and confirmed again returns to the step the project had reached.
      return put({ state: "ok", round: info.round, requestedAt: info.requestedAt, requestedBy: info.requestedBy, decidedAt: input.now, decidedBy: input.actor },
        info.revertedFrom ?? nextStage(gate, yp));
    case "changes": {
      waitingNeeded();
      const allowed = Object.keys(GATE_FIELDS[gate]);
      const fields = [...new Set(input.fields ?? [])];
      if (!fields.length || fields.some(field => !allowed.includes(field))) throw new GateError("FIELDS_REQUIRED", "고칠 칸을 하나 이상 골라 주세요.", 400);
      if (!input.memo?.trim()) throw new GateError("MEMO_REQUIRED", "수정 요청 메모를 써 주세요.", 400);
      return put({ state: "changes", round: info.round, requestedAt: info.requestedAt, requestedBy: info.requestedBy, decidedAt: input.now, decidedBy: input.actor,
        fields, memo: input.memo.trim().slice(0, 1000), ...(info.revertedFrom ? { revertedFrom: info.revertedFrom } : {}) });
    }
    case "hold":
      waitingNeeded();
      if (!input.reason?.trim()) throw new GateError("MEMO_REQUIRED", "보류 사유를 한 줄 써 주세요.", 400);
      return put({ state: "hold", round: info.round, requestedAt: info.requestedAt, requestedBy: info.requestedBy, decidedAt: input.now, decidedBy: input.actor,
        reason: input.reason.trim().slice(0, 300), ...(info.revertedFrom ? { revertedFrom: info.revertedFrom } : {}) });
    case "revert": {
      if (info.state !== "ok") throw new GateError("INVALID_TRANSITION", "처리한 OK만 되돌릴 수 있어요.");
      // D20: 최종 검토 only until the upload starts (T10 adds the upload record).
      if (gate === "review" && !["upload", "review"].includes(yp.stage)) throw new GateError("INVALID_TRANSITION", "업로드를 시작한 뒤에는 최종 검토를 되돌릴 수 없어요.");
      // A step the PD confirmed goes back to the PD as a 수정 요청 (with the 대표's memo) to fix and confirm again — no reminders to the 대표.
      if (info.self) return put({ state: "changes", round: info.round, requestedAt: info.requestedAt, requestedBy: info.requestedBy, decidedAt: input.now, decidedBy: input.actor,
        fields: [], memo: input.memo?.trim().slice(0, 1000) || "대표가 이 단계로 되돌렸어요.", revertedFrom: yp.stage }, GATE_STAGE[gate]);
      return put({ state: "wait", round: info.round, requestedAt: input.now, requestedBy: input.actor, remindAt: firstRemindAt(input.now), revertedFrom: yp.stage }, GATE_STAGE[gate]);
    }
  }
}

/** A gate needs attention from the approver while it waits; 처리한 것 lists what they decided; 보류함 lists holds (S10). */
export function confirmTab<T extends Pick<YpProject, "yp">>(projects: T[], tab: "self" | "wait" | "done" | "hold" | "shorts", me: string) {
  // 쇼츠 확정: every project whose PD confirmed shorts scripts or where someone commented, newest first.
  if (tab === "shorts") return projects.filter(project => project.yp.shortsLog?.length)
    .map(project => ({ project, gate: "shorts" as YpGate, info: project.yp.gates.shorts, at: project.yp.shortsLog!.at(-1)!.at })).sort((a, b) => b.at.localeCompare(a.at));
  const rows = projects.flatMap(project => (Object.keys(project.yp.gates) as YpGate[]).filter(gate => gate !== "shorts").map(gate => ({ project, gate, info: project.yp.gates[gate] })));
  // PD 컨펌: what the PDs confirmed themselves, newest first — the 대표 reads it and leaves notes.
  if (tab === "self") return rows.filter(row => row.info.state === "ok" && row.info.self).sort((a, b) => (b.info.decidedAt ?? "").localeCompare(a.info.decidedAt ?? ""));
  if (tab === "wait") return rows.filter(row => row.info.state === "wait").sort((a, b) => (a.info.requestedAt ?? "").localeCompare(b.info.requestedAt ?? ""));
  if (tab === "hold") return rows.filter(row => row.info.state === "hold").sort((a, b) => (b.info.decidedAt ?? "").localeCompare(a.info.decidedAt ?? ""));
  return rows.filter(row => row.info.decidedBy === me && ["ok", "changes"].includes(row.info.state)).sort((a, b) => (b.info.decidedAt ?? "").localeCompare(a.info.decidedAt ?? ""));
}

/** Gates whose reminder is due; several due at once (the 08:00 morning) become one notification (8-2). */
export function dueReminders<T extends Pick<YpProject, "id" | "yp">>(projects: T[], nowIso: string) {
  return projects.flatMap(project => (Object.keys(project.yp.gates) as YpGate[])
    .filter(gate => project.yp.gates[gate].state === "wait" && ((project.yp.gates[gate] as GateState).remindAt ?? "") <= nowIso)
    .map(gate => ({ project, gate })));
}
