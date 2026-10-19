"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest, ApiRequestError } from "@/lib/api-client";
import { useSession } from "./session-provider";
import { StaffDesign, Step, type StaffJobStatus, type StepState } from "./youtube-production-steps";
import "./youtube-production-steps.css";

interface Storyboard { scenes: number; model: string; at: string; metaphors: { scene: number; type: string; at: string }[]; cta: { after: string; line: string }[];
  summary: { title: string; points: string[] } | null; reasons: { metaphors: string; cta: string; summary: string };
  assets: { kind: string; file: string; url: string; source: string; license: string; use: string }[]; fuzzy: string[]; notes: string[] }
interface MyinRun { id: string; status: string; stage: string; paragraphs: number; paragraphsReady: number; lastErrorCode: string | null;
  words: { words: number; subtitleLines: number; durationSeconds: number } | null; storyboard: Storyboard | null;
  review: { decision: "confirmed" | "revise"; name: string; note: string; at: string } | null;
  assetDecisions: Record<string, { decision: "approved" | "excluded" }>; ctaReady: string | null;
  prepared: { misses: string[]; sheets: number; credits: string[]; at: string } | null }

const PHASE: Record<string, string> = { voice_pending: "음성 만드는 중", words_pending: "렌더 PC가 받아쓰기·자막 만드는 중", words_ready: "받아쓰기·자막 완료",
  storyboard_review: "기획표 확인 대기 (로건님)", storyboard_confirmed: "기획표 확인 완료", cta_pending: "구독 대사 음성 만드는 중",
  prep_pending: "렌더 PC가 자료 준비·미리보기 점검 중", prep_ready: "미리보기 점검 끝" };

const KIND: Record<string, string> = { people: "인물 사진", situations: "상황 사진", bgm: "음악" };
const when = (iso: string) => new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/**
 * ③ › 마이인 v13 (시험), built in stages next to the mind-map steps above: 1) voice, transcription and subtitles; 2) the storyboard
 * by the staff member's AI and Logan's confirmation. Hidden where the DEV pilot is closed.
 */
export function MyinV13Panel({ sourceId }: { sourceId: string }) {
  const { accessToken, profile } = useSession();
  const [run, setRun] = useState<MyinRun | null>(null);
  const [job, setJob] = useState<StaffJobStatus | null>(null);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [qc, setQc] = useState("");
  const [note, setNote] = useState("");
  const [sheets, setSheets] = useState<string[]>([]);
  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const next = (await apiRequest<{ run: MyinRun | null }>(`/api/v1/content/youtube-automation/myin?sourceId=${sourceId}`, { token: accessToken })).run;
      setRun(next); setAvailable(true);
      if (next?.words) setJob(await apiRequest<StaffJobStatus>(`/api/v1/content/youtube-automation/ai-jobs?sourceId=${sourceId}&task=storyboard`, { token: accessToken }));
    } catch (reason) { if (reason instanceof ApiRequestError && reason.status === 404) setAvailable(false); }
  }, [accessToken, sourceId]);
  useEffect(() => { void load(); }, [load]);
  const working = Boolean(run && (["voice_pending", "words_pending", "cta_pending", "prep_pending"].includes(run.stage) && run.status !== "blocked" || (job?.job && ["backlog", "active"].includes(job.job.status))));
  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(timer);
  }, [working, load]);
  if (!available) return null;

  const act = async (label: string, request: () => Promise<unknown>) => {
    setBusy(label); setError("");
    try { await request(); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "처리하지 못했습니다."); }
    finally { setBusy(""); }
  };
  const post = (path: string, method: "POST" | "PATCH", body: Record<string, unknown>) =>
    apiRequest(`/api/v1/content/youtube-automation${path}`, { method, token: accessToken, body: JSON.stringify(body) });
  const showQc = async () => {
    if (!run) return;
    try { setQc((await apiRequest<{ subtitleQc: string }>(`/api/v1/content/youtube-automation/myin?report=${run.id}`, { token: accessToken })).subtitleQc); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "자막 검사표를 열지 못했습니다."); }
  };
  const showSheets = async () => {
    if (!run) return;
    try { setSheets((await apiRequest<{ sheets: string[] }>(`/api/v1/content/youtube-automation/myin?sheets=${run.id}`, { token: accessToken })).sheets); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "점검 시트를 열지 못했습니다."); }
  };
  const phase = run ? run.status === "blocked" ? `멈춤 · 오류 코드 ${run.lastErrorCode ?? "없음"}` : PHASE[run.stage] ?? run.stage : null;
  const board = run?.storyboard;

  const step1: StepState = run?.words ? "done" : "current";
  const step2: StepState = !run?.words ? "waiting" : run.review?.decision === "confirmed" ? "done" : "current";
  const step3: StepState = run?.review?.decision !== "confirmed" ? "waiting" : run.prepared && !run.prepared.misses.length && run.stage === "prep_ready" ? "done" : "current";
  const assetsUsed = board ? board.assets.filter((a) => run?.assetDecisions[a.file]?.decision === "approved") : [];

  return <div className="yt-steps" role="region" aria-label="마이인 v13 시험">
    <section className="panel">
      <header className="panel-header"><div><span className="eyebrow">마이인 v13 · 시험</span><h2>v13으로 만들기</h2>
        <p>승인된 원고로 대표 목소리를 만들고, 렌더 PC가 받아쓰기·자막을 만든 뒤, 내 AI가 장면 기획표를 쓰고 로건님이 확인하면 렌더 PC가 자료를 준비해 점검합니다. 위 마인드맵 단계와는 따로 움직입니다.</p></div></header>
    </section>

    <Step index={0} state={step1} title="음성과 받아쓰기·자막" idBase="myin-step">
      <p>승인된 원고를 대표 목소리(drama-3)로 만들고, 렌더 PC가 로건님 방식대로 다듬어 받아쓰기와 방송 자막을 만듭니다.</p>
      {!run || (run.status === "blocked" && !run.words) ? <div className="yt-actions">
        <button type="button" className="primary-button" disabled={Boolean(busy) || profile?.role !== "admin"} onClick={() => void act("start", () => post("/myin", "POST", { sourceId }))}>{busy === "start" ? "시작하는 중…" : run ? "v13 음성 다시 시작" : "v13 음성 만들기"}</button>
        <small>새 원고라 Fish 음성 비용이 듭니다. 같은 원고로 다시 누르면 만든 음성을 그대로 이어 씁니다.</small>
      </div> : null}
      {run ? <div className="yt-run">
        <div className="yt-run-head"><span className="status-pill" data-status={run.status === "blocked" && !run.words ? "failed" : run.words ? "approved" : "scheduled"}>{run.words ? "받아쓰기·자막 완료" : phase}</span>
          <small>음성 {run.paragraphsReady}/{run.paragraphs}문단</small></div>
        {run.stage === "voice_pending" ? <progress max={run.paragraphs} value={run.paragraphsReady} aria-label="음성 진행" /> : null}
        {run.words ? <small>낭독 {Math.floor(run.words.durationSeconds / 60)}분 {Math.round(run.words.durationSeconds % 60)}초 · 받아쓴 단어 {run.words.words.toLocaleString()}개 · 자막 {run.words.subtitleLines}줄</small> : null}
      </div> : null}
      {run?.words ? <details className="yt-details" onToggle={(event) => { if ((event.target as HTMLDetailsElement).open && !qc) void showQc(); }}>
        <summary>자막 검사표 보기</summary>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 360, overflow: "auto", margin: 0 }}>{qc || "불러오는 중…"}</pre>
      </details> : null}
    </Step>

    <Step index={1} state={step2} title="장면 기획표 (내 AI → 로건님 확인)" idBase="myin-step">
      {!run?.words ? <p>받아쓰기·자막이 끝나면 내 AI에 보낼 수 있습니다.</p> : null}
      {run?.stage === "words_ready" ? <>
        {run.review?.decision === "revise" ? <div className="yt-note yt-warn"><strong>로건님 수정 요청</strong> · {when(run.review.at)}<p>{run.review.note}</p></div> : null}
        <p>내 AI가 로건님 매뉴얼·기획표 문서와 음악 창고 목록을 읽고, 위 받아쓰기의 철자 그대로 장면 기획표와 사진 후보를 만듭니다. OS가 문구 위치와 형식을 검사합니다.</p>
        <StaffDesign status={job} busy={busy === "send"} onSend={() => void act("send", () => post("/ai-jobs", "POST", { task: "storyboard", sourceId }))} />
      </> : null}
      {board && run && run.stage !== "words_ready" ? <>
        <div className="yt-run"><div className="yt-run-head"><span className="status-pill" data-status={run.review?.decision === "confirmed" ? "approved" : "review"}>{run.review?.decision === "confirmed" ? "로건님 확인 완료" : "로건님 확인 대기"}</span>
          <small>장면 {board.scenes}개 · 직원 AI {board.model} · {when(board.at)}</small></div></div>
        <details className="yt-details" open={run.stage === "storyboard_review"}><summary>비유 포인트 {board.metaphors.length}곳</summary>
          <ul className="yt-list">{board.metaphors.map((m) => <li key={m.scene}>{m.scene}번 장면 · {m.type} · “{m.at}”</li>)}</ul>
          <p className="yt-note">{board.reasons.metaphors}</p></details>
        <details className="yt-details" open={run.stage === "storyboard_review"}><summary>구독 요청 {board.cta.length}곳</summary>
          <ul className="yt-list">{board.cta.map((c) => <li key={c.after}>“{c.after}” 뒤 · {c.line}</li>)}</ul>
          <p className="yt-note">{board.reasons.cta}</p></details>
        <details className="yt-details" open={run.stage === "storyboard_review"}><summary>한 장 정리</summary>
          {board.summary ? <><strong>{board.summary.title}</strong><ul className="yt-list">{board.summary.points.map((p) => <li key={p}>{p}</li>)}</ul></> : <p>없음</p>}
          <p className="yt-note">{board.reasons.summary}</p></details>
        <details className="yt-details"><summary>사진 후보 {board.assets.filter((a) => a.kind !== "bgm").length}개</summary>
          <ul className="yt-list">{board.assets.filter((a) => a.kind !== "bgm").map((a) => <li key={a.file}>{KIND[a.kind] ?? a.kind} · {a.file} · {a.source} · {a.license} — {a.use} <a href={a.url} target="_blank" rel="noreferrer">출처</a></li>)}</ul></details>
        {board.fuzzy.length ? <details className="yt-details"><summary>받아쓰기와 비슷한 구간으로만 찾은 문구 {board.fuzzy.length}개</summary>
          <ul className="yt-list">{board.fuzzy.map((f) => <li key={f}>{f}</li>)}</ul></details> : null}
        {board.notes.length ? <details className="yt-details"><summary>AI가 남긴 제안 {board.notes.length}개</summary>
          <ul className="yt-list">{board.notes.map((n) => <li key={n}>{n}</li>)}</ul></details> : null}
        {["storyboard_review", "storyboard_confirmed", "cta_pending", "prep_pending", "prep_ready"].includes(run.stage) ? <div className="yt-note">
          <strong>{run.stage === "storyboard_review" ? "로건님 확인" : "기획표 다시 고치기"}</strong>
          {run.stage === "storyboard_review" ? <p>확인 완료를 누르면 기획표에 쓰인 사진이 허락되고 3단계가 바로 시작됩니다. 음악은 음악 창고 곡이라 따로 받을 것이 없습니다.</p> : null}
          <label>메모 (수정 요청할 때는 필수)<textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="예) 7번 비유는 빼고, 구독은 두 번째 섹션 끝으로" /></label>
          <div className="yt-actions">
            {run.stage === "storyboard_review" ? <button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => void act("confirm", () => post("/myin", "PATCH", { action: "review", runId: run.id, decision: "confirmed", note }))}>{busy === "confirm" ? "저장 중…" : "기획표 확인 완료"}</button> : null}
            <button type="button" className="secondary-button" disabled={Boolean(busy) || !note.trim()} onClick={() => void act("revise", () => post("/myin", "PATCH", { action: "review", runId: run.id, decision: "revise", note }))}>수정 요청</button>
          </div>
          {run.review?.decision === "confirmed" ? <small>{run.review.name} 확인 · {when(run.review.at)}{run.review.note ? ` · ${run.review.note}` : ""}</small> : null}
        </div> : null}
      </> : null}
    </Step>

    <Step index={2} state={step3} title="자료 준비와 미리보기 점검" idBase="myin-step">
      <p>로건님 확인이 끝나면 자동으로 시작합니다. 구독 대사 음성을 만들고, 렌더 PC가 허락된 사진을 받아 음악 창고 곡과 함께 놓은 뒤 로건님 점검 기능으로 문구 위치를 확인합니다.</p>
      {run?.review?.decision === "confirmed" && assetsUsed.length ? <ul className="yt-list">{assetsUsed.map((a) =>
        <li key={a.file}>{KIND[a.kind] ?? a.kind} · {a.file} · {a.source} <a href={a.url} target="_blank" rel="noreferrer">출처</a></li>)}</ul> : null}
      {run && ["cta_pending", "prep_pending"].includes(run.stage) ? <div className="yt-run"><div className="yt-run-head">
        <span className="status-pill" data-status={run.status === "blocked" ? "failed" : "scheduled"}>{run.status === "blocked" ? `멈춤 · 오류 코드 ${run.lastErrorCode ?? "없음"}` : PHASE[run.stage]}</span>
        {run.ctaReady ? <small>구독 대사 {run.ctaReady}</small> : null}</div></div> : null}
      {run?.prepared ? <div className="yt-run">
        <div className="yt-run-head"><span className="status-pill" data-status={run.prepared.misses.length ? "failed" : "approved"}>문구 못 찾음 {run.prepared.misses.length}개</span><small>{when(run.prepared.at)}</small></div>
        {run.prepared.misses.length ? <ul className="yt-list">{run.prepared.misses.map((m) => <li key={m}>{m}</li>)}</ul> : null}
      </div> : null}
      {run?.prepared ? <details className="yt-details" onToggle={(event) => { if ((event.target as HTMLDetailsElement).open && !sheets.length) void showSheets(); }}>
        <summary>점검 시트 {run.prepared.sheets}장 보기</summary>
        <p className="yt-note">장면마다 한 컷씩입니다. 쇼릴 뒤부터는 컷 시각이 조금 앞당겨져 보이니(로건님 점검 기능의 특성), 문구 확인은 위 개수로 합니다.</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URLs from private storage */}
        {sheets.map((url) => <img key={url} src={url} alt="미리보기 점검 시트" style={{ width: "100%", borderRadius: 8 }} />)}
      </details> : null}
      {run?.prepared ? <details className="yt-details"><summary>출처 목록 {run.prepared.credits.length}개 (⑥ 발행 설명란용)</summary>
        <ul className="yt-list">{run.prepared.credits.map((c) => <li key={c}>{c}</li>)}</ul></details> : null}
      {run && (run.stage === "prep_ready" || (run.status === "blocked" && ["cta_pending", "prep_pending"].includes(run.stage))) ? <div className="yt-actions">
        <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void act("prep", () => post("/myin", "PATCH", { action: "prepare", runId: run.id }))}>{busy === "prep" ? "시작하는 중…" : "자료 준비 다시 하기"}</button>
        <small>사진을 다시 받고 점검을 다시 돌립니다. 같은 구독 대사면 음성은 그대로 씁니다.</small></div> : null}
    </Step>
    {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
  </div>;
}
