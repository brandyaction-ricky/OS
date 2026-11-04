"use client";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";

// 영상 편집기 카드 (로건 개발 문서 v2 ③, 대표 2026-11-04: 「OS엔 상태 카드」): who is editing the finished video on which computer, the
// orders sent from members' AI chats and what each became, and the versions confirmed from an editor. The big video and its timeline
// live in the editor on that computer; this card reads the OS only (no video addresses, so its poll costs no storage traffic).

interface EditVersion { v: number; at: string; durationSeconds: number; edit: { name: string; pc: string; fromVersion: string; note: string; orders: number } | null }
interface EditOrder { id: string; at: string; text: string; videoAt: string | null; from: "chat" | "feedback"; name: string; meaning: string;
  status: "queued" | "working" | "done" | "failed" | "declined"; result: { version?: string; note: string } | null }
export interface EditStatus { lock: { name: string; pc: string; since: string } | null; confirming: { at: string; fromVersion: string } | null;
  uploadedAt: string | null; versions: EditVersion[]; orders: EditOrder[] }

/** The local editor's address (Logan's editor/server.py); it opens only on the computer where the editor runs. */
export const LOCAL_EDITOR_URL = "http://127.0.0.1:8772";
const when = (iso: string) => new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
export function orderState(order: Pick<EditOrder, "status" | "result">): { label: string; tone: string } {
  if (order.status === "queued") return { label: "기다리는 중", tone: "waiting" };
  if (order.status === "working") return { label: "고치는 중", tone: "scheduled" };
  if (order.status === "done") return { label: `반영됨${order.result?.version ? ` · ${order.result.version}` : ""}`, tone: "approved" };
  if (order.status === "failed") return { label: "못 만들었어요", tone: "failed" };
  return { label: "못 함", tone: "failed" };
}

export function MyinEditCard({ sourceId, token }: { sourceId: string; token: string | null }) {
  const [status, setStatus] = useState<EditStatus | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!token) return;
    try { setStatus(await apiRequest<EditStatus>(`/api/v1/content/youtube-automation/editor?projectId=${sourceId}&view=edits`, { token })); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "편집 상태를 불러오지 못했어요."); }
  }, [sourceId, token]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  return <EditStatusView status={status} error={error} />;
}

/** The card itself, from what the OS said (null while it loads). */
export function EditStatusView({ status, error = "" }: { status: EditStatus | null; error?: string }) {
  return <section className="yt-run" aria-label="영상 편집기">
    <div className="yt-run-head"><strong>영상 편집기 · 바뀐 곳만 고치기</strong>
      <a className="secondary-button" href={LOCAL_EDITOR_URL} target="_blank" rel="noreferrer">내 컴퓨터 편집기 열기</a></div>
    <p className="yt-note">내 AI 채팅에 「이 영상 3:20 사진 바꿔 줘」처럼 말하면 주문이 들어와요. 편집기를 연 컴퓨터가 바뀐 곳만 다시 만들고, 확정하면 아래에 새 버전으로 올라와요. 편집기는 그 컴퓨터에서만 열려요.</p>
    {error ? <p className="inline-alert danger" role="alert">{error}</p> : !status ? <p>불러오는 중…</p> : <>
      <dl className="yt-record">
        <dt>지금 편집</dt>
        <dd>{status.lock ? `${status.lock.name}님이 편집 중 · ${status.lock.pc} · ${when(status.lock.since)}부터${status.confirming ? ` · ${status.confirming.fromVersion} 확정 올리는 중` : ""}` : "지금 편집하는 사람 없어요"}</dd>
        <dt>버전</dt>
        <dd><ul className="yt-list">{status.versions.map((version) => <li key={version.at}>
          <strong>v{version.v}</strong> · {when(version.at)} · {version.edit
            ? `${version.edit.name}님이 ${version.edit.pc}에서 확정 · 편집기 ${version.edit.fromVersion}에서${version.edit.orders ? ` · 주문 ${version.edit.orders}건` : ""}${version.edit.note ? ` · “${version.edit.note}”` : ""}`
            : "OS가 만듦"}</li>)}</ul></dd>
        {status.uploadedAt ? <><dt>유튜브</dt><dd>{when(status.uploadedAt)}에 올렸어요 · 2주 뒤 각 컴퓨터의 편집 파일을 정리해요</dd></> : null}
      </dl>
      {status.orders.length ? <ul className="yt-sub-list" aria-label="편집 주문">{status.orders.map((order) => {
        const state = orderState(order);
        return <li key={order.id}>
          <span className="status-pill" data-status={state.tone}>{state.label}</span>
          <span className="yt-sub-at">{order.videoAt ?? "—"}</span>
          <span>{order.text} <small>· {order.name}님 · {when(order.at)}{order.from === "feedback" ? " · 최종 검토 피드백" : ""}{order.result?.note ? ` · ${order.result.note}` : ""}</small></span>
        </li>;
      })}</ul> : <p><small>아직 편집 주문이 없어요.</small></p>}
    </>}
  </section>;
}
