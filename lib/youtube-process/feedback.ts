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
