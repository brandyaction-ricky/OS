// 영상 피드백 (개발 요청 8cb3c12e, R02~R04): what each action does to one feedback item. Pure, so the server, the demo
// client and the tests apply exactly the same rules.

export type FeedbackReply = { id: string; by: string; byId: string; text: string; at: string; editedAt?: string; deleted?: boolean };
export type FeedbackState = {
  text: string; whoId: string; status: "open" | "done" | "declined"; declinedWhy: string; fixedIn: number | null; replies: FeedbackReply[];
  doneBy?: string; doneAt?: string; confirmedBy?: string; confirmedAt?: string; deleted?: boolean; editedAt?: string;
};
export type FeedbackAction = "resolve" | "reopen" | "decline" | "reply" | "confirm" | "unconfirm" | "edit" | "delete" | "reply_edit" | "reply_delete";
export type FeedbackActor = { id: string; name: string; admin: boolean };
export class FeedbackRuleError extends Error {
  code: string; status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}

/** Replies saved before replies had ids get a stable one from their time, so they can still be shown and referenced. */
export function normalizeReplies(raw: unknown): FeedbackReply[] {
  return Array.isArray(raw) ? raw.map((row: Partial<FeedbackReply>) => ({ id: row.id || `legacy-${row.at ?? ""}`, by: String(row.by ?? ""), byId: String(row.byId ?? ""), text: String(row.text ?? ""), at: String(row.at ?? ""),
    ...(row.editedAt ? { editedAt: row.editedAt } : {}), ...(row.deleted ? { deleted: true } : {}) })) : [];
}

/** Actions that only add to or edit one's own words never collide with a status change, so they use the latest saved row. */
export const appendOnly = (action: FeedbackAction) => ["reply", "reply_edit", "reply_delete", "confirm", "unconfirm", "edit", "delete"].includes(action);

export function applyFeedback(state: FeedbackState, actor: FeedbackActor, input: { action: FeedbackAction; text?: string; replyId?: string }, now: string, latestVersion: number | null, target: string): FeedbackState {
  const text = (input.text ?? "").trim();
  const own = state.whoId === actor.id;
  const need = (ok: boolean, code: string, message: string, status = 400) => { if (!ok) throw new FeedbackRuleError(code, message, status); };
  switch (input.action) {
    case "resolve": {
      need(!state.deleted, "FEEDBACK_DELETED", "삭제된 피드백이에요.");
      const { confirmedBy: _by, confirmedAt: _at, ...rest } = state; void _by; void _at;
      return { ...rest, status: "done", fixedIn: target === "video" ? latestVersion : null, doneBy: actor.name, doneAt: now };
    }
    case "reopen": {
      const { doneBy: _a, doneAt: _b, confirmedBy: _c, confirmedAt: _d, ...rest } = state; void _a; void _b; void _c; void _d;
      return { ...rest, status: "open", fixedIn: null, declinedWhy: "" };
    }
    case "decline":
      need(Boolean(text), "REASON_REQUIRED", "반영하지 않는 이유를 한 줄 써 주세요.");
      return { ...state, status: "declined", declinedWhy: text };
    case "confirm":
      need(own || actor.admin, "CONFIRM_FORBIDDEN", "피드백을 남긴 사람만 반영을 확인할 수 있어요.", 403);
      need(state.status === "done", "NOT_DONE", "편집자가 반영을 표시한 뒤에 확인할 수 있어요.", 409);
      return { ...state, confirmedBy: actor.name, confirmedAt: now };
    case "unconfirm": {
      need(own || actor.admin, "CONFIRM_FORBIDDEN", "피드백을 남긴 사람만 확인을 되돌릴 수 있어요.", 403);
      const { confirmedBy: _by, confirmedAt: _at, ...rest } = state; void _by; void _at;
      return rest;
    }
    case "reply":
      need(Boolean(text), "REPLY_REQUIRED", "답글을 써 주세요.");
      return { ...state, replies: [...state.replies, { id: globalThis.crypto.randomUUID(), by: actor.name, byId: actor.id, text, at: now }].slice(-100) };
    case "edit":
      need(own, "EDIT_FORBIDDEN", "내가 쓴 피드백만 고칠 수 있어요.", 403);
      need(!state.deleted, "FEEDBACK_DELETED", "삭제된 피드백은 고칠 수 없어요.");
      need(Boolean(text), "TEXT_REQUIRED", "내용을 써 주세요.");
      return { ...state, text, editedAt: now };
    case "delete":
      need(own, "DELETE_FORBIDDEN", "내가 쓴 피드백만 지울 수 있어요.", 403);
      // The words go; the thread under it stays (요청: 「삭제된 댓글입니다」 자리에 기존 답글 보존).
      return { ...state, text: "", deleted: true };
    case "reply_edit":
    case "reply_delete": {
      const reply = state.replies.find(row => row.id === input.replyId);
      need(Boolean(reply), "REPLY_NOT_FOUND", "답글을 찾지 못했어요.", 404);
      need(reply!.byId === actor.id, "REPLY_FORBIDDEN", "내가 쓴 답글만 고치거나 지울 수 있어요.", 403);
      need(!reply!.deleted, "REPLY_DELETED", "삭제된 답글이에요.");
      if (input.action === "reply_edit") need(Boolean(text), "REPLY_REQUIRED", "답글을 써 주세요.");
      return { ...state, replies: state.replies.map(row => row.id !== input.replyId ? row : input.action === "reply_edit" ? { ...row, text, editedAt: now } : { ...row, text: "", deleted: true }) };
    }
  }
}

/** A deleted item no longer waits for anyone; done and declined are closed as before. */
export const feedbackClosed = (item: Pick<FeedbackState, "status" | "deleted">) => item.status !== "open" || item.deleted === true;

// ---- N01~N07 (검토 편의 기능) ----------------------------------------------------------------------------------------

/** N04 핀 · N05 화살표·사각형·자유그림. Points are fractions of the frame (0–1), so they fit any player size. */
export type FeedbackMark = { type: "pin" | "arrow" | "rect" | "free"; points: [number, number][] };
/** N06 참고 이미지·파일, stored privately under the project. */
export type FeedbackFile = { path: string; name: string; mime: string; size: number };
export const FEEDBACK_FILE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf" };
export const FEEDBACK_FILE_MAX = 10 * 1024 * 1024;
export const FEEDBACK_FILES_PER_ITEM = 5;
export const feedbackFilePath = (projectId: string) => new RegExp(`^feedback/${projectId}/[0-9]{13}-[0-9a-f-]{36}\\.(jpg|png|webp|gif|pdf)$`);

/** Keeps marks inside the frame and small: at most 20 shapes, 200 points each, numbers rounded to 0.001. */
export function cleanMarks(raw: unknown): FeedbackMark[] {
  if (!Array.isArray(raw)) return [];
  const clamp = (value: unknown) => Math.round(Math.min(1, Math.max(0, Number(value) || 0)) * 1000) / 1000;
  return raw.slice(0, 20).flatMap((mark: { type?: unknown; points?: unknown }) => {
    if (!["pin", "arrow", "rect", "free"].includes(String(mark?.type)) || !Array.isArray(mark.points)) return [];
    const points = (mark.points as unknown[]).slice(0, 200).filter(Array.isArray).map(point => [clamp((point as unknown[])[0]), clamp((point as unknown[])[1])] as [number, number]);
    const need = mark.type === "pin" ? 1 : 2;
    return points.length >= need ? [{ type: mark.type as FeedbackMark["type"], points: mark.type === "pin" ? points.slice(0, 1) : mark.type === "free" ? points : points.slice(0, 2) }] : [];
  });
}

/** N03: people called with @이름 (display names may contain spaces only if written without them, e.g. @예시PD). */
export function mentionedIds(text: string, members: { id: string; name: string }[]): string[] {
  const squash = (value: string) => value.replace(/\s+/g, "");
  const tokens = [...text.matchAll(/@([^\s@,.!?·]{1,30})/g)].map(match => squash(match[1]));
  return [...new Set(members.filter(member => member.name && tokens.some(token => token === squash(member.name) || token.startsWith(squash(member.name)))).map(member => member.id))];
}

/** Who hears about a new reply: the author, everyone who replied before, and anyone @mentioned — never the replier. */
export function replyRecipients(item: { whoId: string; replies: { byId: string }[] }, text: string, members: { id: string; name: string }[], actorId: string): string[] {
  return [...new Set([item.whoId, ...item.replies.map(row => row.byId), ...mentionedIds(text, members)])].filter(id => id && id !== actorId);
}

export type FeedbackFilter = "all" | "open" | "done" | "declined";
export const FEEDBACK_FILTER_LABEL: Record<FeedbackFilter, string> = { all: "전체", open: "미반영", done: "반영됨", declined: "반영 안 함" };
/** N01 검색 (피드백·답글·쓴 사람) + N02 상태별 필터. A deleted item is found only under 전체. */
export function feedbackMatches(item: { text: string; who: string; status: string; deleted?: boolean; replies: { text: string; by: string }[] }, query: string, filter: FeedbackFilter) {
  if (filter !== "all" && (item.deleted || item.status !== filter)) return false;
  const words = query.trim().toLocaleLowerCase("ko-KR").split(/\s+/).filter(Boolean);
  const haystack = [item.text, item.who, ...item.replies.flatMap(row => [row.text, row.by])].join(" ").toLocaleLowerCase("ko-KR");
  return words.every(word => haystack.includes(word));
}

/** N07: the B side's time for a given A time, with a manual offset for cuts of different length (never below 0). */
export const compareTime = (aTime: number, offset: number, bDuration: number) => Math.max(0, Math.min(bDuration || Infinity, aTime + offset));
