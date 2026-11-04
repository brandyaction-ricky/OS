// 영상 편집기 (로건 개발 문서 v2, 2026-11-04 · 대표: ②-2 OS 서버부터): who may edit a finished video now, and where an order is.
// One video, one editor: the lock names the person and the computer, and the OS final it started from (a confirm checks that).

export interface EditLock { by: string; name: string; pc: string; since: string; seenAt: string; basedOn: string | null }

/** A lock its computer stopped renewing (closed, crashed) frees the video after this long. */
export const EDIT_LOCK_STALE_MS = 10 * 60_000;

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
