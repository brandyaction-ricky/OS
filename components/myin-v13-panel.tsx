"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest, ApiRequestError } from "@/lib/api-client";
import { useSession } from "./session-provider";
import { StaffDesign, type StaffJobStatus } from "./youtube-production-steps";
import "./youtube-production-steps.css";

interface Storyboard { scenes: number; model: string; at: string; metaphors: { scene: number; type: string; at: string }[]; cta: { after: string; line: string }[];
  summary: { title: string; points: string[] } | null; reasons: { metaphors: string; cta: string; summary: string };
  assets: { kind: string; file: string; url: string; source: string; license: string; use: string }[]; fuzzy: string[]; notes: string[] }
interface MyinRun { id: string; status: string; stage: string; paragraphs: number; paragraphsReady: number; lastErrorCode: string | null;
  words: { words: number; subtitleLines: number; durationSeconds: number } | null; storyboard: Storyboard | null;
  review: { decision: "confirmed" | "revise"; name: string; note: string; at: string } | null;
  assetDecisions: Record<string, { decision: "approved" | "excluded"; uploaded: boolean }>; ctaReady: string | null;
  prepared: { misses: string[]; sheets: number; credits: string[]; at: string } | null }

const PHASE: Record<string, string> = { voice_pending: "음성 만드는 중", words_pending: "렌더 PC가 받아쓰기·자막 만드는 중", words_ready: "받아쓰기·자막 완료",
  storyboard_review: "기획표 확인 대기 (로건님)", storyboard_confirmed: "기획표 확인 완료", cta_pending: "구독 대사 음성 만드는 중",
  prep_pending: "렌더 PC가 자료 준비·미리보기 점검 중", prep_ready: "미리보기 점검 끝" };
// Photo sites the render PC downloads from by itself; anything else (Pixabay blocks automated downloads) is uploaded by a person.
const autoFetch = (url: string) => /^https:\/\/(unsplash\.com\/photos\/|commons\.wikimedia\.org\/wiki\/File:)/.test(url);
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
  const uploadAsset = (file: string, picked: File) => act(`up-${file}`, async () => {
    const { signedUrl } = await post("/myin", "PATCH", { action: "upload", runId: run!.id, file }) as { signedUrl: string };
    const response = await fetch(signedUrl, { method: "PUT", headers: { "content-type": picked.type || "application/octet-stream", "x-upsert": "true" }, body: picked });
    if (!response.ok) throw new Error(`올리지 못했습니다 (${response.status}). 파일 형식과 크기를 확인해 주세요.`);
    await post("/myin", "PATCH", { action: "uploaded", runId: run!.id, file });
  });
  const showSheets = async () => {
    if (!run) return;
    try { setSheets((await apiRequest<{ sheets: string[] }>(`/api/v1/content/youtube-automation/myin?sheets=${run.id}`, { token: accessToken })).sheets); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "점검 시트를 열지 못했습니다."); }
  };
  const phase = run ? run.status === "blocked" ? `멈춤 · 오류 코드 ${run.lastErrorCode ?? "없음"}` : PHASE[run.stage] ?? run.stage : null;
  const board = run?.storyboard;

  return <section className="panel writing-workflow" aria-label="마이인 v13 시험">
    <header className="panel-header"><div><span className="eyebrow">마이인 v13 · 시험</span><h2>v13 음성 · 받아쓰기 · 기획표</h2>
      <p>승인된 원고를 대표 목소리(drama-3)로 만들고, 렌더 PC가 로건님 방식대로 받아쓰기와 자막을 만든 뒤, 내 AI가 장면 기획표를 쓰고 로건님이 확인합니다. 위 마인드맵 단계와는 따로 움직입니다.</p></div></header>

    <h3>1. 음성과 받아쓰기·자막</h3>
    {!run || (run.status === "blocked" && !run.words) ? <div className="yt-actions">
      <button type="button" className="primary-button" disabled={Boolean(busy) || profile?.role !== "admin"} onClick={() => void act("start", () => post("/myin", "POST", { sourceId }))}>{busy === "start" ? "시작하는 중…" : run ? "v13 음성 다시 시작" : "v13 음성 만들기"}</button>
      <small>새 원고라 Fish 음성 비용이 듭니다. 같은 원고로 다시 누르면 만든 음성을 그대로 이어 씁니다.</small>
    </div> : null}
    {run ? <div className="yt-run">
      <div className="yt-run-head"><span className="status-pill" data-status={run.status === "blocked" ? "failed" : run.words ? "approved" : "scheduled"}>{run.words ? "받아쓰기·자막 완료" : phase}</span>
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

    {run?.words ? <>
      <h3>2. 장면 기획표</h3>
      {run.stage === "words_ready" ? <>
        {run.review?.decision === "revise" ? <p className="yt-note yt-warn"><strong>로건님 수정 요청</strong> · {run.review.name} · {when(run.review.at)}<br />{run.review.note}</p> : null}
        <p className="yt-note">내 AI가 로건님 매뉴얼·기획표 문서를 읽고, 위 받아쓰기의 철자 그대로 장면 기획표와 사진·음악 후보를 만듭니다. OS가 문구 위치와 형식을 검사합니다.</p>
        <StaffDesign status={job} busy={busy === "send"} onSend={() => void act("send", () => post("/ai-jobs", "POST", { task: "storyboard", sourceId }))} />
      </> : null}
      {board && run.stage !== "words_ready" ? <div className="yt-run">
        <div className="yt-run-head"><span className="status-pill" data-status={run.stage === "storyboard_confirmed" ? "approved" : "review"}>{PHASE[run.stage] ?? run.stage}</span>
          <small>장면 {board.scenes}개 · 직원 AI {board.model} · {when(board.at)}</small></div>
        <details className="yt-details" open><summary>비유 포인트 {board.metaphors.length}곳</summary>
          <ul className="yt-list">{board.metaphors.map((m) => <li key={m.scene}>{m.scene}번 장면 · {m.type} · “{m.at}”</li>)}</ul>
          <p className="yt-note">{board.reasons.metaphors}</p></details>
        <details className="yt-details" open><summary>구독 요청 {board.cta.length}곳</summary>
          <ul className="yt-list">{board.cta.map((c) => <li key={c.after}>“{c.after}” 뒤 · {c.line}</li>)}</ul>
          <p className="yt-note">{board.reasons.cta}</p></details>
        <details className="yt-details" open><summary>한 장 정리</summary>
          {board.summary ? <><strong>{board.summary.title}</strong><ul className="yt-list">{board.summary.points.map((p) => <li key={p}>{p}</li>)}</ul></> : <p>없음</p>}
          <p className="yt-note">{board.reasons.summary}</p></details>
        <details className="yt-details"><summary>사진·음악 후보 {board.assets.length}개 (3단계에서 하나씩 허락)</summary>
          <ul className="yt-list">{board.assets.map((a) => <li key={a.file}>{KIND[a.kind] ?? a.kind} · {a.file} · {a.source} · {a.license} — {a.use} <a href={a.url} target="_blank" rel="noreferrer">출처</a></li>)}</ul></details>
        {board.fuzzy.length ? <details className="yt-details"><summary>받아쓰기와 비슷한 구간으로만 찾은 문구 {board.fuzzy.length}개 (엉뚱한 곳일 수 있어 확인)</summary>
          <ul className="yt-list">{board.fuzzy.map((f) => <li key={f}>{f}</li>)}</ul></details> : null}
        {board.notes.length ? <ul className="yt-list">{board.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
        {run.stage === "storyboard_review" ? <div style={{ display: "grid", gap: 8 }}>
          <label>로건님 메모 (수정 요청할 때는 필수)<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="예) 7번 비유는 빼고, 구독은 두 번째 섹션 끝으로" /></label>
          <div className="yt-actions">
            <button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => void act("confirm", () => post("/myin", "PATCH", { action: "review", runId: run.id, decision: "confirmed", note }))}>{busy === "confirm" ? "저장 중…" : "기획표 확인 완료"}</button>
            <button type="button" className="secondary-button" disabled={Boolean(busy) || !note.trim()} onClick={() => void act("revise", () => post("/myin", "PATCH", { action: "review", runId: run.id, decision: "revise", note }))}>수정 요청</button>
          </div></div> : null}
        {run.review?.decision === "confirmed" ? <small>{run.review.name} 확인 · {when(run.review.at)}{run.review.note ? ` · ${run.review.note}` : ""}. 다음은 3단계(사진·음악 허락, 사이트 캡처, 구독 대사)입니다.</small> : null}
      </div> : null}
    </> : null}
    {board && run?.review?.decision === "confirmed" ? <>
      <h3>3. 사진·음악과 미리보기 점검</h3>
      <p className="yt-note">기획표에 쓰인 파일은 모두 허락해야 합니다. Unsplash·위키미디어 사진은 렌더 PC가 직접 받고, 음악(Pixabay)은 출처 페이지에서 내려받아 여기에 올립니다. Pixabay는 자동으로 받는 것을 막아 둡니다.</p>
      <ul className="yt-list">{board.assets.map((a) => {
        const d = run.assetDecisions[a.file];
        const needsUpload = d?.decision === "approved" && !autoFetch(a.url);
        return <li key={a.file} style={{ display: "grid", gap: 4 }}>
          <span>{KIND[a.kind] ?? a.kind} · <strong>{a.file}</strong> · {a.source} · {a.license} — {a.use} <a href={a.url} target="_blank" rel="noreferrer">출처 페이지</a></span>
          <span className="yt-actions">
            <span className="status-pill" data-status={d?.decision === "approved" ? (needsUpload && !d.uploaded ? "review" : "approved") : d ? "failed" : "waiting"}>
              {d?.decision === "approved" ? (needsUpload ? (d.uploaded ? "허락 · 올림" : "허락 · 파일 올리기 필요") : "허락 · 렌더 PC가 받음") : d ? "뺌" : "미정"}</span>
            <button type="button" className="secondary-button compact" disabled={Boolean(busy) || d?.decision === "approved"} onClick={() => void act(`a-${a.file}`, () => post("/myin", "PATCH", { action: "asset", runId: run.id, file: a.file, decision: "approved" }))}>허락</button>
            <button type="button" className="secondary-button compact" disabled={Boolean(busy) || d?.decision === "excluded"} onClick={() => void act(`x-${a.file}`, () => post("/myin", "PATCH", { action: "asset", runId: run.id, file: a.file, decision: "excluded" }))}>빼기</button>
            {needsUpload ? <input type="file" aria-label={`${a.file} 올리기`} accept={a.kind === "bgm" ? "audio/mpeg,.mp3" : "image/*"} disabled={Boolean(busy)}
              onChange={(event) => { const picked = event.target.files?.[0]; if (picked) void uploadAsset(a.file, picked); }} /> : null}
          </span></li>;
      })}</ul>
      {["storyboard_confirmed", "prep_ready"].includes(run.stage) || (run.status === "blocked" && ["cta_pending", "prep_pending"].includes(run.stage)) ? <div className="yt-actions">
        <button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => void act("prep", () => post("/myin", "PATCH", { action: "prepare", runId: run.id }))}>{busy === "prep" ? "시작하는 중…" : run.prepared ? "자료 준비 다시 하기" : "자료 준비 시작"}</button>
        <small>구독 대사 음성을 만들고(Fish), 렌더 PC가 파일을 받아 로건님 미리보기 점검을 돌립니다.</small></div> : null}
      {["cta_pending", "prep_pending"].includes(run.stage) ? <p className="yt-note">{run.status === "blocked" ? `멈춤 · 오류 코드 ${run.lastErrorCode ?? "없음"}` : PHASE[run.stage]}{run.ctaReady ? ` · 구독 대사 ${run.ctaReady}` : ""}</p> : null}
      {run.prepared ? <div className="yt-run">
        <div className="yt-run-head"><span className="status-pill" data-status={run.prepared.misses.length ? "failed" : "approved"}>미리보기 점검 · 문구 못 찾음 {run.prepared.misses.length}개</span><small>{when(run.prepared.at)}</small></div>
        {run.prepared.misses.length ? <ul className="yt-list">{run.prepared.misses.map((m) => <li key={m}>{m}</li>)}</ul> : null}
        <details className="yt-details" onToggle={(event) => { if ((event.target as HTMLDetailsElement).open && !sheets.length) void showSheets(); }}>
          <summary>점검 시트 {run.prepared.sheets}장 보기</summary>
          <p className="yt-note">장면마다 한 컷씩입니다. 쇼릴 뒤부터는 컷 시각이 조금 앞당겨져 보이니(로건님 점검 기능의 특성), 문구 확인은 위 개수로 합니다.</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URLs from private storage */}
          {sheets.map((url) => <img key={url} src={url} alt="미리보기 점검 시트" style={{ width: "100%", borderRadius: 8 }} />)}
        </details>
        <details className="yt-details"><summary>출처 목록 {run.prepared.credits.length}개 (⑥ 발행 설명란용)</summary>
          <ul className="yt-list">{run.prepared.credits.map((c) => <li key={c}>{c}</li>)}</ul></details>
      </div> : null}
    </> : null}
    {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
  </section>;
}
