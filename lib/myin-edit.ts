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
