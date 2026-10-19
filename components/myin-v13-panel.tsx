"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest, ApiRequestError } from "@/lib/api-client";
import { useSession } from "./session-provider";
import "./youtube-production-steps.css";

interface MyinRun { id: string; status: string; stage: string; paragraphs: number; paragraphsReady: number; lastErrorCode: string | null;
  words: { words: number; subtitleLines: number; durationSeconds: number } | null }

const PHASE: Record<string, string> = { voice_pending: "음성 만드는 중", words_pending: "렌더 PC가 받아쓰기·자막 만드는 중", words_ready: "받아쓰기·자막 완료" };

/**
 * ③ › 마이인 v13 (시험): stage 1 of the v13 build — the voice for the approved script and the render PC's transcription and
 * subtitles. The mind-map steps above stay as they are until v13 becomes the default. Hidden where the DEV pilot is closed.
 */
export function MyinV13Panel({ sourceId }: { sourceId: string }) {
  const { accessToken, profile } = useSession();
  const [run, setRun] = useState<MyinRun | null>(null);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [qc, setQc] = useState("");
  const load = useCallback(async () => {
    if (!accessToken) return;
    try { setRun((await apiRequest<{ run: MyinRun | null }>(`/api/v1/content/youtube-automation/myin?sourceId=${sourceId}`, { token: accessToken })).run); setAvailable(true); }
    catch (reason) { if (reason instanceof ApiRequestError && reason.status === 404) setAvailable(false); }
  }, [accessToken, sourceId]);
  useEffect(() => { void load(); }, [load]);
  const working = Boolean(run && ["backlog", "in_progress"].includes(run.status));
  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(timer);
  }, [working, load]);
  if (!available) return null;

  const start = async () => {
    setBusy(true); setError("");
    try { setRun((await apiRequest<{ run: MyinRun }>("/api/v1/content/youtube-automation/myin", { method: "POST", token: accessToken, body: JSON.stringify({ sourceId }) })).run); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "시작하지 못했습니다."); }
    finally { setBusy(false); }
  };
  const showQc = async () => {
    if (!run) return;
    try { setQc((await apiRequest<{ subtitleQc: string }>(`/api/v1/content/youtube-automation/myin?report=${run.id}`, { token: accessToken })).subtitleQc); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "자막 검사표를 열지 못했습니다."); }
  };
  const phase = run ? run.status === "blocked" ? `멈춤 · 오류 코드 ${run.lastErrorCode ?? "없음"}` : PHASE[run.stage] ?? run.stage : null;

  return <section className="panel writing-workflow" aria-label="마이인 v13 시험">
    <header className="panel-header"><div><span className="eyebrow">마이인 v13 · 1단계 시험</span><h2>v13 음성과 받아쓰기·자막</h2>
      <p>승인된 원고를 대표 목소리(drama-3)로 만들고, 렌더 PC가 로건님 방식대로 다듬은 뒤 받아쓰기와 자막을 만듭니다. 위 마인드맵 단계와는 따로 움직입니다.</p></div></header>
    {!run || run.status === "blocked" ? <div className="yt-actions">
      <button type="button" className="primary-button" disabled={busy || profile?.role !== "admin"} onClick={() => void start()}>{busy ? "시작하는 중…" : run ? "v13 음성 다시 시작" : "v13 음성 만들기"}</button>
      <small>새 원고라 Fish 음성 비용이 듭니다. 같은 원고로 다시 누르면 만든 음성을 그대로 이어 씁니다.</small>
    </div> : null}
    {run ? <div className="yt-run">
      <div className="yt-run-head"><span className="status-pill" data-status={run.status === "done" ? "approved" : run.status === "blocked" ? "failed" : "scheduled"}>{phase}</span>
        <small>음성 {run.paragraphsReady}/{run.paragraphs}문단</small></div>
      {run.stage === "voice_pending" ? <progress max={run.paragraphs} value={run.paragraphsReady} aria-label="음성 진행" /> : null}
      {run.words ? <>
        <small>낭독 {Math.floor(run.words.durationSeconds / 60)}분 {Math.round(run.words.durationSeconds % 60)}초 · 받아쓴 단어 {run.words.words.toLocaleString()}개 · 자막 {run.words.subtitleLines}줄</small>
        <details className="yt-details" onToggle={(event) => { if ((event.target as HTMLDetailsElement).open && !qc) void showQc(); }}>
          <summary>자막 검사표 보기</summary>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 360, overflow: "auto" }}>{qc || "불러오는 중…"}</pre>
        </details>
      </> : null}
    </div> : null}
    {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
  </section>;
}
