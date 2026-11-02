"use client";
import { FEEDBACK_KIND_LABEL, feedbackKind, type FeedbackKind } from "@/lib/youtube-process/feedback";
import type { YpFeedbackView } from "./youtube-process-data";

const fmt = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const KINDS: FeedbackKind[] = ["sound", "subtitle", "screen", "other"];
/** The feedback list reads at most this many notes (lib/server/youtube-process-feedback.ts). */
const READ_LIMIT = 500;

/**
 * 댓글을 할 일로 모으기 (유쓰 요청 7/8, 2026-11-02): the open notes of the list below, grouped as 소리 · 자막 · 화면 · 기타. Worked out each
 * time from the notes themselves, so an edited or deleted note changes or leaves its group at once; nothing is stored, copied as a new
 * note or marked 반영됨 from here.
 */
export function FeedbackTodo({ items, total, ver, onPick }: { items: YpFeedbackView[]; total: number; ver: number; onPick: (item: YpFeedbackView) => void }) {
  if (!items.length) return null;
  const groups = KINDS.map(kind => ({ kind, rows: items.filter(item => feedbackKind(item.text) === kind) })).filter(group => group.rows.length);
  return <details className="yp-todo">
    <summary>할 일로 묶어 보기 <span className="yp-muted">{groups.map(group => `${FEEDBACK_KIND_LABEL[group.kind]} ${group.rows.length}`).join(" · ")}</span></summary>
    {total >= READ_LIMIT ? <p className="yp-hint">피드백이 많아 앞의 {READ_LIMIT}개만 묶었어요(일부 정리).</p> : null}
    {groups.map(group => <div key={group.kind} className="yp-todo-g"><b>{FEEDBACK_KIND_LABEL[group.kind]} {group.rows.length}</b>
      <ul>{group.rows.map(item => {
        const replies = item.replies.filter(reply => !reply.deleted).length;
        return <li key={item.id}><button type="button" className="yp-lnk" onClick={() => onPick(item)}>▷ {fmt(item.t ?? item.range?.[0] ?? 0)}{item.ver !== ver ? ` · v${item.ver}` : ""}</button>
          <span>{item.text}</span><span className="yp-muted">{item.who}{replies ? ` · 답글 ${replies}` : ""}</span></li>;
      })}</ul></div>)}
    <p className="yp-hint">원래 피드백을 종류별로 묶어 보여 주기만 해요. 반영 표시는 각 피드백에서, 음성 다시 만들기는 지금처럼 「음성 피드백」 칸에서 해요.</p>
  </details>;
}
