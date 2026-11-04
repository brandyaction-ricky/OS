// 영상 편집기 (로건 개발 문서 v2, 2026-11-04 · 대표: ②-2 OS 서버부터): who may edit a finished video now, and where an order is.
// One video, one editor: the lock names the person and the computer, and the OS final it started from (a confirm checks that).

export interface EditLock { by: string; name: string; pc: string; since: string; seenAt: string; basedOn: string | null }

/** A lock its computer stopped renewing (closed, crashed) frees the video after this long (로건 개발 문서 v3 7.1: a 30-minute lease). */
export const EDIT_LOCK_STALE_MS = 30 * 60_000;

/** 인계 기록 (v3 7.1 · 7.2-8): who took, handed over, finished or (an admin) forced open a video's edit lock — the last 30. */
export interface LockEvent { kind: "lock" | "handover" | "unlock" | "force"; name: string; pc: string; at: string; from?: { name: string; pc: string }; reason?: string }
export const withLockEvent = (history: LockEvent[] | undefined, event: LockEvent) => [...(history ?? []), event].slice(-30);

/** 음량 검사 (v3 7.2-6): an edited final is held to the 완성 line — −14 LUFS ±1 and a peak at −1 dB or lower. Empty = fine. */
export function editLoudnessIssue(lufs: number, peak: number) {
  return Math.abs(lufs + 14) > 1 || peak > -1 ? `음량 ${lufs} LUFS(−15~−13이어야 해요) · 최대 ${peak} dB(−1 이하여야 해요)` : "";
}

/** take: free or stale · renew: mine on this computer · held: someone else (or my other computer) is editing. */
export function lockDecision(current: EditLock | null | undefined, who: { by: string; pc: string }, now: number) {
  if (!current || now - Date.parse(current.seenAt) > EDIT_LOCK_STALE_MS) return { kind: "take" as const };
  if (current.by === who.by && current.pc === who.pc) return { kind: "renew" as const };
  return { kind: "held" as const, lock: current };
}

export type EditOrderStatus = "queued" | "working" | "done" | "failed" | "declined";
/** An order moves only forward: queued → working → done | failed, or declined (못 함) before it is done; failed may be queued again. */
export function orderMove(from: EditOrderStatus, to: EditOrderStatus) {
  const next: Record<EditOrderStatus, EditOrderStatus[]> = { queued: ["working", "declined"], working: ["done", "failed", "declined", "queued"], failed: ["queued", "declined"], done: [], declined: [] };
  return next[from].includes(to);
}

/** The editor's frame rate (Logan's engine renders 60 fps). */
export const EDIT_FPS = 60;
export interface EditCheck { decodeErrors: number; frames: number; end: number; videoSeconds: number; audioSeconds: number }
/**
 * 확정 전 자동 검사 (로건 시험장 final_check): the computer measures its final with ffmpeg; the OS holds the line. No decode errors,
 * frames = length × 60 (±1), sound and picture the same length (under 1.5 frames + 30 ms). Empty = it may be confirmed.
 */
export function editCheckIssues(c: EditCheck) {
  const want = Math.round(c.end * EDIT_FPS), out: string[] = [];
  if (c.decodeErrors) out.push(`디코드 오류 ${c.decodeErrors}건`);
  if (Math.abs(c.frames - want) > 1) out.push(`프레임 수 ${c.frames} / 예상 ${want}`);
  if (Math.abs(c.videoSeconds - c.audioSeconds) >= 1.5 / EDIT_FPS + 0.03) out.push(`소리·화면 길이(화면 ${c.videoSeconds.toFixed(3)}초 · 소리 ${c.audioSeconds.toFixed(3)}초)`);
  return out;
}

export interface FeedOrder { at: string; updatedAt: string; text: string; name: string; from: "chat" | "feedback"; status: EditOrderStatus; result: { version?: string; note: string; at: string } | null }
export interface FeedVersion { at: string; edit: { name: string; pc: string; orders: number } | null }
/**
 * 편집 소식 (로건 개발 문서 v3 6-5 · P5): what happened to a video's edit since `since`, oldest first, as lines the member's AI chat says
 * to them — the editor screen itself shows none of it (P10: no version numbers or order lists on the screen).
 */
export function editFeed(state: { lock: { name: string; pc: string; since: string } | null; orders: FeedOrder[]; versions: FeedVersion[]; uploadedAt: string | null; history?: LockEvent[] }, since: string | null) {
  const out: { at: string; kind: string; text: string }[] = [];
  // The lock's own record when there is one; a session from before it was kept says only who edits now.
  if (state.history?.length) for (const e of state.history) out.push({ at: e.at, kind: e.kind === "lock" ? "editing" : e.kind, text:
    e.kind === "lock" ? `${e.name}님이 ${e.pc}에서 편집을 시작했어요.`
      : e.kind === "handover" ? `${e.name}님이 ${e.pc}에서 이어서 편집해요(${e.from?.name}님 잠금이 30분 동안 신호가 없었어요).`
      : e.kind === "unlock" ? `${e.name}님이 ${e.pc}에서 편집을 마쳤어요.`
      : `관리자 ${e.name}님이 ${e.from?.name}님(${e.from?.pc})의 편집 잠금을 풀었어요${e.reason ? `: ${e.reason}` : "."}` });
  else if (state.lock) out.push({ at: state.lock.since, kind: "editing", text: `${state.lock.name}님이 ${state.lock.pc}에서 편집을 시작했어요.` });
  for (const o of state.orders) {
    out.push({ at: o.at, kind: "order", text: `${o.name}님 ${o.from === "feedback" ? "최종 검토 피드백이" : "주문이"} 들어왔어요: “${o.text}”` });
    if (o.status === "working") out.push({ at: o.updatedAt, kind: "working", text: `“${o.text}” 고치는 중이에요.` });
    if (o.result && o.status === "done") out.push({ at: o.result.at, kind: "done", text: `“${o.text}” 고친 영상이 나왔어요. 편집기에서 보고 완성하면 OS 완성본이 돼요.` });
    if (o.result && o.status === "failed") out.push({ at: o.result.at, kind: "failed", text: `“${o.text}”을 만들지 못했어요${o.result.note ? `: ${o.result.note}` : "."} 이전 영상은 그대로예요.` });
    if (o.result && o.status === "declined") out.push({ at: o.result.at, kind: "declined", text: `“${o.text}”은 할 수 없어요${o.result.note ? `: ${o.result.note}` : "."}` });
  }
  for (const v of state.versions) if (v.edit) out.push({ at: v.at, kind: "confirmed", text: `${v.edit.name}님이 ${v.edit.pc}에서 완성해 새 완성본이 올라왔어요${v.edit.orders ? `(주문 ${v.edit.orders}건)` : ""}.` });
  if (state.uploadedAt) out.push({ at: state.uploadedAt, kind: "uploaded", text: "유튜브에 올렸어요. 2주 뒤 각 컴퓨터의 편집 파일을 정리해요." });
  return out.filter((e) => !since || e.at > since).sort((a, b) => a.at.localeCompare(b.at));
}
