"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { apiRequest, ApiRequestError } from "@/lib/api-client";
import { useSession } from "./session-provider";
import { StaffDesign, Step, type StaffJobStatus, type StepState } from "./youtube-production-steps";
import "./youtube-production-steps.css";
import { CostTag, useCostConfirm, useCostModels, voiceEstimate } from "./cost-notice";

interface Storyboard { scenes: number; model: string; at: string; metaphors: { scene: number; type: string; at: string }[]; cta: { after: string; line: string }[];
  summary: { title: string; points: string[] } | null; reasons: { metaphors: string; cta: string; summary: string };
  assets: { kind: string; file: string; url: string; source: string; license: string; use: string }[]; fuzzy: string[]; notes: string[] }
interface MyinRun { id: string; status: string; stage: string; paragraphs: number; paragraphsReady: number; lastErrorCode: string | null;
  words: { words: number; subtitleLines: number; durationSeconds: number } | null; storyboard: Storyboard | null;
  review: { decision: "confirmed" | "revise"; name: string; note: string; at: string } | null;
  assetDecisions: Record<string, { decision: "approved" | "excluded" }>; ctaReady: string | null;
  prepared: { misses: string[]; sheets: number; credits: string[]; at: string } | null;
  clips: { name: string; label: string }[] | null; clipsReview: { name: string; note: string; at: string } | null;
  final: { bytes: number; durationSeconds: number; lufs: number; peak: number; at: string } | null; scriptChanged?: boolean }
interface Outputs { clips: { label: string; url: string | null }[]; video: string | null; summary: string | null; deck: string | null; srt: string | null }

const PHASE: Record<string, string> = { voice_pending: "음성 만드는 중", words_pending: "렌더 PC가 받아쓰기·자막 만드는 중", words_ready: "받아쓰기·자막 완료",
  storyboard_review: "기획표 확인 대기 (로건, 유쓰)", storyboard_confirmed: "기획표 확인 완료", cta_pending: "구독 대사 음성 만드는 중",
  prep_pending: "렌더 PC가 자료 준비·미리보기 점검 중", prep_ready: "미리보기 점검 끝", clips_pending: "렌더 PC가 시안 영상 만드는 중",
  clips_review: "시안 확인 대기 (로건, 유쓰)", final_pending: "렌더 PC가 전체 영상 만드는 중 (10~15분)", final_ready: "완성" };
const LATER = ["clips_pending", "clips_review", "final_pending", "final_ready"];

const KIND: Record<string, string> = { people: "인물 사진", situations: "상황 사진", bgm: "음악" };
const when = (iso: string) => new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/**
 * ③ 영상 제작: every new video is made in Logan's 마이인 v13 format (owner decision 2026-10-19) — voice and subtitles, the staff AI's
 * storyboard and its confirmation, preparation, preview clips, then the finished video and handouts. Where the pilot is closed
 * (production today) it says so instead.
 */
export function MyinV13Panel({ sourceId, finalNote, embedded = false, onFinal, voiceText }: { sourceId: string; finalNote?: ReactNode; embedded?: boolean; onFinal?: () => void;
  /** The spoken paragraphs, for the company-money estimate shown before the voice is made (owner request 2026-10-25). */ voiceText?: string }) {
  const cost = useCostConfirm(), { myinVoice } = useCostModels();
  // Fish drama-3 bills by the bytes it reads; ask before a new script is voiced, and before the storyboard's 구독 요청 lines are.
  const askVoice = async (text: string, again: string) => {
    if (!text.trim()) return true;
    const estimate = voiceEstimate(text, myinVoice);
    return cost.confirm({ model: myinVoice, amount: estimate.krw, detail: `${estimate.chars.toLocaleString("ko-KR")}자 · ${again}`, ok: "확인하고 만들기" });
  };
  const { accessToken } = useSession();
  const [run, setRun] = useState<MyinRun | null>(null);
  const [job, setJob] = useState<StaffJobStatus | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [qc, setQc] = useState("");
  const [note, setNote] = useState("");
  const [sheets, setSheets] = useState<string[]>([]);
  const [outputs, setOutputs] = useState<Outputs | null>(null);
  const lastStage = useRef<string | null>(null);
  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const next = (await apiRequest<{ run: MyinRun | null }>(`/api/v1/content/youtube-automation/myin?sourceId=${sourceId}`, { token: accessToken })).run;
      setRun(next); setAvailable(true);
      // A final that appears while the screen is open tells the page (제작 counts it as a new version).
      if (next?.stage === "final_ready" && lastStage.current && lastStage.current !== "final_ready") onFinal?.();
      lastStage.current = next?.stage ?? null;
      if (next?.clips || next?.final) setOutputs(await apiRequest<Outputs>(`/api/v1/content/youtube-automation/myin?outputs=${next.id}`, { token: accessToken }));
      if (next?.words) setJob(await apiRequest<StaffJobStatus>(`/api/v1/content/youtube-automation/ai-jobs?sourceId=${sourceId}&task=storyboard`, { token: accessToken }));
    } catch (reason) { if (reason instanceof ApiRequestError && reason.status === 404) setAvailable(false); }
  }, [accessToken, sourceId, onFinal]);
  useEffect(() => { void load(); }, [load]);
  const working = Boolean(run && (["voice_pending", "words_pending", "cta_pending", "prep_pending", "clips_pending", "final_pending"].includes(run.stage) && run.status !== "blocked" || (job?.job && ["backlog", "active"].includes(job.job.status))));
  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(timer);
  }, [working, load]);
  if (available === null) return <section className="panel load-error" role="status">영상 제작 정보를 불러오는 중…</section>;
  if (!available) return <section className="panel empty-state"><div><h3>영상 자동 제작은 아직 연결 전입니다</h3><p>지금은 개발용 시험 서버에서만 시범 운영 중입니다. 운영 연결은 대표 승인 후 진행합니다.</p></div></section>;

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

  const step1: StepState = run?.words && !run.scriptChanged ? "done" : "current";
  const step2: StepState = !run?.words ? "waiting" : run.review?.decision === "confirmed" ? "done" : "current";
  const step3: StepState = run?.review?.decision !== "confirmed" ? "waiting" : LATER.includes(run.stage) ? "done" : "current";
  const step4: StepState = !run || !LATER.includes(run.stage) ? "waiting" : ["final_pending", "final_ready"].includes(run.stage) ? "done" : "current";
  const step5: StepState = run?.stage === "final_ready" ? "done" : run?.stage === "final_pending" ? "current" : "waiting";
  const assetsUsed = board ? board.assets.filter((a) => run?.assetDecisions[a.file]?.decision === "approved") : [];

  return <div className="yt-steps" role="region" aria-label="마이인 영상 만들기">
    {cost.element}
    {embedded ? null : <section className="panel">
      <header className="panel-header"><div><span className="eyebrow">마이인 형식 · 로건님 v13</span><h2>영상 만들기</h2>
        <p>승인된 원고로 대표 목소리를 만들고, 렌더 PC가 받아쓰기·자막을 만듭니다. 내 AI가 장면 기획표를 쓰고 로건, 유쓰가 기획표와 시안을 확인하면, 렌더 PC가 완성 영상과 한 장 정리·덱 PDF·자막 파일을 만들어 올립니다.</p></div></header>
    </section>}

    <Step index={0} state={step1} title="음성과 받아쓰기·자막" idBase="myin-step">
      <p>승인된 원고를 대표 목소리(drama-3)로 만들고, 렌더 PC가 로건님 방식대로 다듬어 받아쓰기와 방송 자막을 만듭니다.</p>
      {run?.scriptChanged ? <p className="yt-note yt-warn">구성안 원고가 바뀌었어요. 아래 작업은 옛 원고로 만든 것이라 더 진행되지 않아요. 새로 만들면 기획표와 시안 확인도 다시 거쳐요.</p> : null}
      {!run || (run.status === "blocked" && !run.words) || run.scriptChanged ? <div className="yt-actions">
        <button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => void (async () => { if (run && !run.scriptChanged || await askVoice(voiceText ?? "", "같은 원고로 다시 누르면 들지 않아요")) await act("start", () => post("/myin", "POST", { sourceId })); })()}>{busy === "start" ? "시작하는 중…" : run?.scriptChanged ? "바뀐 원고로 v13 음성 다시 만들기" : run ? "v13 음성 다시 시작" : "v13 음성 만들기"}</button>
        <small><CostTag kind="paid" /> 같은 원고로 다시 누르면 만든 음성을 이어 써요.</small>
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

    <Step index={1} state={step2} title="장면 기획표 (내 AI → 로건, 유쓰 확인)" idBase="myin-step">
      {!run?.words ? <p>받아쓰기·자막이 끝나면 내 AI에 보낼 수 있습니다.</p> : null}
      {run?.stage === "words_ready" ? <>
        {run.review?.decision === "revise" ? <div className="yt-note yt-warn"><strong>로건, 유쓰 수정 요청 · {when(run.review.at)}</strong><p>{run.review.note}</p></div> : null}
        <p>내 AI가 로건님 매뉴얼·기획표 문서와 음악 창고 목록을 읽고, 위 받아쓰기의 철자 그대로 장면 기획표와 사진 후보를 만듭니다. OS가 문구 위치와 형식을 검사합니다.</p>
        <StaffDesign status={job} busy={busy === "send"} onSend={() => void act("send", () => post("/ai-jobs", "POST", { task: "storyboard", sourceId }))} />
      </> : null}
      {board && run && run.stage !== "words_ready" ? <>
        <div className="yt-run"><div className="yt-run-head"><span className="status-pill" data-status={run.review?.decision === "confirmed" ? "approved" : "review"}>{run.review?.decision === "confirmed" ? "로건, 유쓰 확인 완료" : "로건, 유쓰 확인 대기"}</span>
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
          <strong>{run.stage === "storyboard_review" ? "로건, 유쓰 확인" : "기획표 다시 고치기"}</strong>
          {run.stage === "storyboard_review" ? <p>확인 완료를 누르면 기획표에 쓰인 사진이 허락되고 3단계가 바로 시작됩니다. 음악은 음악 창고 곡이라 따로 받을 것이 없습니다.</p> : null}
          <label>메모 (수정 요청할 때는 필수)<textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="예) 7번 비유는 빼고, 구독은 두 번째 섹션 끝으로" /></label>
          <div className="yt-actions">
            {run.stage === "storyboard_review" ? <button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => void (async () => { if (await askVoice(board.cta.map(c => c.line).join("\n"), "이미 만든 문장은 다시 들지 않아요")) await act("confirm", () => post("/myin", "PATCH", { action: "review", runId: run.id, decision: "confirmed", note })); })()}>{busy === "confirm" ? "저장 중…" : "기획표 확인 완료"}</button> : null}
            {run.stage === "storyboard_review" && board.cta.length ? <CostTag kind="paid" /> : null}
            <button type="button" className="secondary-button" disabled={Boolean(busy) || !note.trim()} onClick={() => void act("revise", () => post("/myin", "PATCH", { action: "review", runId: run.id, decision: "revise", note }))}>수정 요청</button>
          </div>
          {run.review?.decision === "confirmed" ? <small>{run.review.name} 확인 · {when(run.review.at)}{run.review.note ? ` · ${run.review.note}` : ""}</small> : null}
        </div> : null}
      </> : null}
    </Step>

    <Step index={2} state={step3} title="자료 준비와 미리보기 점검" idBase="myin-step">
      <p>로건, 유쓰 확인이 끝나면 자동으로 시작합니다. 구독 대사 음성을 만들고, 렌더 PC가 허락된 사진을 받아 음악 창고 곡과 함께 놓은 뒤 로건님 점검 기능으로 문구 위치를 확인합니다.</p>
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
      {run && (run.stage === "prep_ready" || (run.status === "blocked" && ["cta_pending", "prep_pending", "clips_pending"].includes(run.stage))) ? <div className="yt-actions">
        <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void act("prep", () => post("/myin", "PATCH", { action: "prepare", runId: run.id }))}>{busy === "prep" ? "시작하는 중…" : "자료 준비 다시 하기"}</button>
        <small>사진을 다시 받고 점검을 다시 돌립니다. 같은 구독 대사면 음성은 그대로 씁니다.</small></div> : null}
    </Step>

    <Step index={3} state={step4} title="시안 확인 (로건, 유쓰)" idBase="myin-step">
      <p>렌더 PC가 오프닝·쇼릴과 비유 장면만 720p로 먼저 만듭니다. 로건, 유쓰가 연출을 보고 확인하면 전체 영상을 만듭니다. 고칠 곳이 있으면 2번 카드의 수정 요청으로 기획표를 고칩니다.</p>
      {run && ["clips_pending"].includes(run.stage) ? <div className="yt-run"><div className="yt-run-head">
        <span className="status-pill" data-status={run.status === "blocked" ? "failed" : "scheduled"}>{run.status === "blocked" ? `멈춤 · 오류 코드 ${run.lastErrorCode ?? "없음"}` : PHASE[run.stage]}</span></div></div> : null}
      {outputs?.clips.length ? <div style={{ display: "grid", gap: 12 }}>{outputs.clips.map((clip) => <div key={clip.label} style={{ display: "grid", gap: 4 }}>
        <small>{clip.label}</small>{clip.url ? <video src={clip.url} controls preload="metadata" style={{ width: "100%", borderRadius: 8, background: "#000" }} /> : null}</div>)}</div> : null}
      {run?.stage === "clips_review" ? <div className="yt-note">
        <strong>로건, 유쓰 확인</strong>
        <label>메모 (선택)<textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="예) 오프닝 좋음" /></label>
        <div className="yt-actions"><button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => void act("clips", () => post("/myin", "PATCH", { action: "clips_ok", runId: run.id, note }))}>{busy === "clips" ? "저장 중…" : "시안 확인 완료 · 전체 영상 만들기"}</button></div>
      </div> : null}
      {run?.clipsReview ? <small>{run.clipsReview.name} 확인 · {when(run.clipsReview.at)}{run.clipsReview.note ? ` · ${run.clipsReview.note}` : ""}</small> : null}
    </Step>

    <Step index={4} state={step5} title="완성 영상과 자료" idBase="myin-step">
      <p>1080p 전체 영상, 음향 마스터링, 한 장 정리 이미지와 덱 PDF, 유튜브 자막 파일을 렌더 PC가 만들어 올립니다.</p>
      {run?.stage === "final_pending" ? <div className="yt-run"><div className="yt-run-head">
        <span className="status-pill" data-status={run.status === "blocked" ? "failed" : "scheduled"}>{run.status === "blocked" ? `멈춤 · 오류 코드 ${run.lastErrorCode ?? "없음"}` : PHASE[run.stage]}</span></div>
        {run.status === "blocked" ? <div className="yt-actions"><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void act("final", () => post("/myin", "PATCH", { action: "clips_ok", runId: run.id, note: "" }))}>{busy === "final" ? "시작하는 중…" : "전체 영상 다시 만들기"}</button></div> : null}</div> : null}
      {run?.final ? <div className="yt-run"><div className="yt-run-head">
        <span className="status-pill" data-status={Math.abs(run.final.lufs + 14) <= 1 && run.final.peak <= -1 ? "approved" : "review"}>완성 · {Math.floor(run.final.durationSeconds / 60)}분 {Math.round(run.final.durationSeconds % 60)}초</span>
        <small>{(run.final.bytes / 1e6).toFixed(1)}MB · 음량 {run.final.lufs} LUFS · 최대 {run.final.peak} dB · {when(run.final.at)}</small></div></div> : null}
      {outputs?.video ? <video src={outputs.video} controls preload="metadata" style={{ width: "100%", borderRadius: 8, background: "#000" }} /> : null}
      {run?.final && outputs ? <ul className="yt-list">
        {outputs.summary ? <li><a href={outputs.summary} target="_blank" rel="noreferrer">한 장 정리 이미지 (PNG)</a></li> : null}
        {outputs.deck ? <li><a href={outputs.deck} target="_blank" rel="noreferrer">덱 전체 (PDF) — 설명란·고정 댓글용</a></li> : null}
        {outputs.srt ? <li><a href={outputs.srt} target="_blank" rel="noreferrer">유튜브 자막 파일 (SRT)</a></li> : null}
      </ul> : null}
      {run?.final ? finalNote ?? <p className="yt-note">이어폰으로 소리를 확인한 뒤 <a href={`/content/production?sourceId=${sourceId}`}>제작 현황 › 제작 자산·전체 승인 현황</a>에서 대표가 관문 3(최종 영상·발행키트)을 승인하고, <a href={`/content/publishing?sourceId=${sourceId}`}>⑥ 발행·업로드</a>에서 [OS 완성본 쓰기]로 올립니다. 발행키트는 ⑦ 유튜브 관리에서 만듭니다. 자막 파일과 엔드 스크린은 유튜브 스튜디오에서 사람이 합니다.</p> : null}
    </Step>
    {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
  </div>;
}
