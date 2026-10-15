"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiRequest } from "@/lib/api-client";
import type { YoutubeAutomationPlan } from "@/lib/youtube-automation-plan";
import { MINDMAP_DECKS, YOUTUBE_VISUAL_TEMPLATE_VERSION, type MindmapDeck } from "@/lib/youtube-visual-template";
import { useSession } from "./session-provider";
import "./youtube-production-steps.css";

interface Render { status: string; stage: string; lastErrorCode: string | null }
interface VoiceRun { id: string; status: string; stage: string; segmentCount: number; segmentsReady: number; readyIndexes: number[]; needsAttention: string[]; lastErrorCode: string | null; createdAt: string; render: Render | null }
interface StoredPlan {
  inputKey?: string; templateVersion?: string; generatedAt?: string; unresolvedAcknowledged?: { by?: string; count?: number };
  plan?: { sections?: string[]; scenes?: Array<{ segmentIndex: number; deck: MindmapDeck; items: string[]; section: number }>; unresolved?: string[] };
}
type StepState = "done" | "current" | "waiting";
// Status pills use the OS kit's data-status colors (components/os-ui.css) and always carry a word.
const STEP_PILL: Record<StepState, { status: string; label: string }> = {
  done: { status: "approved", label: "완료" }, current: { status: "review", label: "할 차례" }, waiting: { status: "draft", label: "대기" },
};
const STEPS = ["원고 준비", "화면 설계", "음성·영상 제작", "완성 영상 확인"] as const;

/** Where a run stands, in words staff can act on. */
function runPhase(run: VoiceRun): { label: string; tone: "progress" | "ready" | "problem"; detail: string } {
  if (run.render?.stage === "render_ready") return { label: "완성", tone: "ready", detail: "4단계에서 바로 볼 수 있습니다." };
  if (run.status === "blocked") return { label: "음성 확인 필요", tone: "problem", detail: run.needsAttention.length ? "아래 항목을 원고에서 고친 뒤 다시 시작해 주세요." : `오류 코드 ${run.lastErrorCode ?? "없음"}. 개발 담당에게 알려 주세요.` };
  if (run.render?.status === "blocked") return { label: "영상 제작 실패", tone: "problem", detail: `세 번 시도했지만 실패했습니다(오류 코드 ${run.render.lastErrorCode ?? "없음"}). 개발 담당에게 알려 주세요.` };
  if (run.stage !== "voice_ready") return { label: `음성 만드는 중 · ${run.segmentsReady}/${run.segmentCount}단락`, tone: "progress", detail: "같은 원고면 기존 녹음을 다시 써서 바로 끝납니다." };
  if (run.render?.stage === "rendering") return { label: "영상 만드는 중", tone: "progress", detail: "10분 안팎 걸립니다." };
  return { label: "영상 제작 대기", tone: "progress", detail: run.render?.lastErrorCode ? `한 번 실패해 다시 시도합니다(오류 코드 ${run.render.lastErrorCode}).` : "작업용 컴퓨터가 차례대로 가져가 만듭니다." };
}
const PHASE_PILL = { progress: "scheduled", ready: "approved", problem: "failed" } as const;

function Step({ index, state, children }: { index: number; state: StepState; children: ReactNode }) {
  const pill = STEP_PILL[state];
  return <section id={`yt-step-${index + 1}`} className={`panel yt-step yt-step-${state}`} aria-current={state === "current" ? "step" : undefined} aria-labelledby={`yt-step-title-${index + 1}`}>
    <header className="panel-header"><h2 id={`yt-step-title-${index + 1}`}><span className="yt-step-no" aria-hidden="true">{state === "done" ? "✓" : index + 1}</span>{index + 1}. {STEPS[index]}</h2>
      <span className="status-pill" data-status={pill.status}>{pill.label}</span></header>
    <div className="panel-pad-lg yt-step-body">{children}</div>
  </section>;
}

/**
 * ③ 영상 제작 for one content item, in the order staff follow it: approved script → AI screen design →
 * voice and video → watch. A step bar on top shows where things stand; each step says what it needs next.
 */
export function YoutubeProductionSteps({ sourceId, storedPlan, onChange }: { sourceId: string; storedPlan: unknown; onChange: () => Promise<void> }) {
  const { accessToken, profile } = useSession();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [plan, setPlan] = useState<YoutubeAutomationPlan | null>(null);
  const [previewConfigured, setPreviewConfigured] = useState(false);
  const [runs, setRuns] = useState<VoiceRun[] | null>(null);
  const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState(""); const [segmentUrl, setSegmentUrl] = useState(""); const [videoUrl, setVideoUrl] = useState("");
  const [notesRead, setNotesRead] = useState(false);
  const isAdmin = profile?.role === "admin";

  const load = useCallback(async () => {
    try {
      const automation = await apiRequest<{ plan: YoutubeAutomationPlan; voicePreviewConfigured: boolean }>(`/api/v1/content/youtube-automation?sourceId=${encodeURIComponent(sourceId)}`, { token: accessToken });
      setPlan(automation.plan); setPreviewConfigured(automation.voicePreviewConfigured); setAvailable(true);
    } catch { setAvailable(false); return; }
    try { setRuns((await apiRequest<{ runs: VoiceRun[] }>(`/api/v1/content/youtube-automation/runs?sourceId=${encodeURIComponent(sourceId)}`, { token: accessToken })).runs); }
    catch { setRuns(null); }
  }, [accessToken, sourceId]);
  useEffect(() => { setPreviewUrl(""); setSegmentUrl(""); setVideoUrl(""); setNotesRead(false); void load(); }, [load]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const latest = runs?.[0];
  const phase = latest ? runPhase(latest) : null;
  const working = phase?.tone === "progress";
  // While a run is being made, check every 20 seconds so staff never have to reload.
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => { void load(); }, 20_000);
    return () => clearInterval(timer);
  }, [working, load]);

  const act = async (label: string, action: () => Promise<unknown>, reload = true) => {
    setBusy(label); setError("");
    try { await action(); if (reload) { await load(); await onChange(); } }
    catch (reason) { setError(reason instanceof Error ? reason.message : "처리하지 못했습니다."); }
    finally { setBusy(""); }
  };
  const post = (path: string, method: "POST" | "PATCH", body: Record<string, unknown>) =>
    apiRequest(`/api/v1/content/youtube-automation${path}`, { method, token: accessToken, body: JSON.stringify({ sourceId, inputKey: plan?.inputKey, ...body }) });
  const previewVoice = () => act("preview", async () => {
    const response = await fetch("/api/v1/content/youtube-automation", { method: "POST", cache: "no-store",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ sourceId, inputKey: plan?.inputKey }) });
    if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message || "목소리 미리듣기를 만들지 못했습니다.");
    setPreviewUrl(URL.createObjectURL(await response.blob()));
  }, false);
  const listen = (runId: string, index: number) => act("listen", async () => {
    const params = new URLSearchParams({ sourceId, runId, segmentIndex: String(index) });
    setSegmentUrl((await apiRequest<{ url: string }>(`/api/v1/content/youtube-automation/runs?${params}`, { token: accessToken })).url);
  }, false);
  const openVideo = () => act("video", async () => {
    setVideoUrl((await apiRequest<{ url: string }>(`/api/v1/content/youtube-automation/video?sourceId=${encodeURIComponent(sourceId)}`, { token: accessToken })).url);
  }, false);

  if (available === null) return <section className="panel load-error" role="status">영상 제작 정보를 불러오는 중…</section>;
  if (!available || !plan) return <section className="panel empty-state"><div><h3>영상 자동 제작은 아직 연결 전입니다</h3><p>지금은 개발용 시험 서버에서만 시범 운영 중입니다. 운영 연결은 대표 승인 후 진행합니다.</p></div></section>;
  const stored = (storedPlan ?? null) as StoredPlan | null;
  const design = stored && plan.inputKey && stored.inputKey === plan.inputKey && stored.templateVersion === YOUTUBE_VISUAL_TEMPLATE_VERSION ? stored.plan : null;
  const notes = design?.unresolved ?? [];
  const notesDone = Boolean(design) && (!notes.length || (stored?.unresolvedAcknowledged?.by === profile?.id && stored?.unresolvedAcknowledged?.count === notes.length));
  const scriptReady = Boolean(plan.inputKey) && !plan.missing.length;
  const madeForDesign = latest && stored?.generatedAt && Date.parse(latest.createdAt) >= Date.parse(stored.generatedAt) ? latest : undefined;
  const videoReady = Boolean(runs?.some((run) => run.render?.stage === "render_ready"));
  const sections = design?.sections ?? [];
  const states: StepState[] = [
    scriptReady ? "done" : "current",
    !scriptReady ? "waiting" : notesDone ? "done" : "current",
    !notesDone ? "waiting" : madeForDesign?.render?.stage === "render_ready" ? "done" : "current",
    videoReady ? "done" : "waiting",
  ];

  return <div className="yt-steps">
    <nav className="yt-stepbar" aria-label="영상 제작 단계">
      {STEPS.map((title, index) => <a key={title} href={`#yt-step-${index + 1}`} className={`yt-stepbar-item yt-${states[index]}`} aria-current={states[index] === "current" ? "step" : undefined}>
        <b aria-hidden="true">{states[index] === "done" ? "✓" : index + 1}</b>{title}<span className="yt-sr">{` · ${STEP_PILL[states[index]].label}`}</span>
      </a>)}
      <button type="button" className="ghost-button compact yt-refresh" disabled={Boolean(busy)} onClick={() => void act("reload", load, false)}>상태 새로 보기</button>
    </nav>
    {latest && phase ? <div className={`yt-banner yt-banner-${phase.tone}`} role="status">
      <span className="status-pill" data-status={PHASE_PILL[phase.tone]}>{phase.label}</span>
      <span className="yt-grow">{phase.detail}{working ? " 이 화면은 20초마다 자동으로 새로 고쳐집니다." : ""}</span>
      {phase.tone === "ready" ? <a className="secondary-button compact" href="#yt-step-4">영상 보기</a> : null}
    </div> : null}
    {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
    {!isAdmin ? <p className="yt-note">제작 실행은 콘텐츠를 맡은 관리자만 할 수 있습니다. 진행 상황과 완성 영상은 볼 수 있습니다.</p> : null}

    <Step index={0} state={states[0]}>
      {scriptReady ? <p>승인된 원고와 제목·썸네일이 연결됐습니다.</p> : <>
        <p>아래 항목을 앞 단계에서 먼저 마쳐 주세요.</p>
        <ul className="yt-list">{plan.missing.map((item) => <li key={item}>{item}</li>)}</ul>
        <div className="yt-actions"><Link className="secondary-button" href={`/content/scripts?topic=${encodeURIComponent(sourceId)}`}>② 원고·스크립트로 가기</Link></div>
      </>}
      {scriptReady && isAdmin && previewConfigured ? <div className="yt-actions">
        <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void previewVoice()}>{busy === "preview" ? "목소리 만드는 중…" : "첫 단락 목소리 미리듣기"}</button>
      </div> : null}
      {previewUrl ? <audio controls src={previewUrl} aria-label="첫 단락 목소리 미리듣기" /> : null}
    </Step>

    <Step index={1} state={states[1]}>
      <p>AI가 원고를 읽고 단락마다 도식 하나와 화면에 나올 짧은 문구, 위쪽 막대에 보일 섹션을 정합니다.</p>
      {!design && scriptReady ? <div className="yt-actions">
        <button type="button" className="primary-button" disabled={Boolean(busy) || !isAdmin} onClick={() => void act("design", () => post("/scenes", "POST", {}))}>
          {busy === "design" ? "설계하는 중… (1분 정도)" : "화면 설계 만들기"}
        </button>
        <small>AI 사용료가 한 번 듭니다.</small>
      </div> : null}
      {design ? <>
        <p className="yt-summary"><strong>{design.scenes?.length ?? 0}단락</strong> · 섹션 {sections.length}개 {sections.map((name, index) => <span key={`${index}-${name}`} className="yt-chip">{name}</span>)}</p>
        <details className="yt-details">
          <summary>단락별 화면 보기</summary>
          <div className="yt-scroll-x"><table className="data-table yt-table">
            <thead><tr><th scope="col">단락</th><th scope="col">도식</th><th scope="col">화면 문구</th><th scope="col">섹션</th></tr></thead>
            <tbody>{design.scenes?.map((scene) => <tr key={scene.segmentIndex}>
              <td>{scene.segmentIndex + 1}</td><td className="cell-title">{MINDMAP_DECKS[scene.deck]?.name ?? scene.deck}</td>
              <td>{scene.items.join(" · ")}</td><td>{sections[scene.section]}</td>
            </tr>)}</tbody>
          </table></div>
        </details>
        {notes.length && notesDone ? <details className="yt-details">
          <summary>AI가 남긴 확인할 점 {notes.length}개 · 확인 완료</summary>
          <ul className="yt-list">{notes.map((note) => <li key={note}>{note}</li>)}</ul>
        </details> : null}
        {notes.length && !notesDone ? <div className="yt-note yt-warn">
          <strong>AI가 남긴 확인할 점 {notes.length}개</strong>
          <ul className="yt-list">{notes.map((note) => <li key={note}>{note}</li>)}</ul>
          {isAdmin ? <div className="yt-actions">
            <label className="yt-check"><input type="checkbox" checked={notesRead} onChange={(event) => setNotesRead(event.target.checked)} />위 내용을 읽었고, 이대로 제작해도 됩니다.</label>
            <button type="button" className="primary-button" disabled={Boolean(busy) || !notesRead} onClick={() => void act("ack", () => post("/scenes", "PATCH", { acknowledgeUnresolved: true }))}>확인 완료</button>
          </div> : <p>관리자가 확인하면 다음 단계로 넘어갑니다.</p>}
        </div> : null}
      </> : null}
    </Step>

    <Step index={2} state={states[2]}>
      <p>대표 목소리 음성을 만들고, 이어서 마인드맵 영상을 만들어 비공개로 저장합니다. 영상은 작업용 컴퓨터가 켜져 있을 때 만들어집니다.</p>
      {notesDone && !madeForDesign ? <div className="yt-actions">
        <button type="button" className="primary-button" disabled={Boolean(busy) || !isAdmin} onClick={() => void act("run", () => post("/runs", "POST", {}))}>
          {busy === "run" ? "등록하는 중…" : "제작 시작"}
        </button>
        <small>같은 원고면 기존 녹음을 다시 써서 음성 비용이 들지 않습니다.</small>
      </div> : null}
      {latest && phase ? <div className="yt-run">
        <div className="yt-run-head"><span className="status-pill" data-status={PHASE_PILL[phase.tone]}>{phase.label}</span>
          <small>{new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(latest.createdAt))} 시작</small></div>
        {phase.tone === "progress" && latest.stage !== "voice_ready" ? <progress max={latest.segmentCount} value={latest.segmentsReady} aria-label="음성 진행" /> : null}
        {latest.needsAttention.length ? <ul className="yt-list">{latest.needsAttention.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
        {!madeForDesign ? <p>이 기록은 지금 화면 설계보다 먼저 만든 것입니다. 새 설계로 만들려면 위 ‘제작 시작’을 눌러 주세요.</p> : null}
      </div> : null}
      {latest?.readyIndexes.length ? <details className="yt-details">
        <summary>단락별 음성 듣기</summary>
        <div className="yt-segments">{latest.readyIndexes.map((index) => <button type="button" className="secondary-button compact" disabled={Boolean(busy)} key={index} onClick={() => void listen(latest.id, index)}>{index + 1}단락</button>)}</div>
        {segmentUrl ? <audio key={segmentUrl} controls autoPlay src={segmentUrl} aria-label="단락 음성 듣기" /> : null}
      </details> : null}
      {runs === null ? <p className="yt-note">제작 기록은 콘텐츠 담당자만 볼 수 있습니다.</p> : null}
    </Step>

    <Step index={3} state={states[3]}>
      {!videoUrl ? <p>{videoReady ? "가장 최근에 완성된 영상을 이 화면에서 바로 볼 수 있습니다." : "영상이 완성되면 여기서 볼 수 있습니다."}</p> : null}
      <div className="yt-actions">
        <button type="button" className={videoReady && !videoUrl ? "primary-button" : "secondary-button"} disabled={Boolean(busy) || (!videoReady && runs !== null)} onClick={() => void openVideo()}>
          {busy === "video" ? "여는 중…" : videoUrl ? "영상 다시 열기" : "영상 보기"}
        </button>
        {videoUrl ? <a className="secondary-button" href={`${videoUrl}${videoUrl.includes("?") ? "&" : "?"}download=${encodeURIComponent(`${sourceId}.mp4`)}`}>내려받기</a> : null}
      </div>
      {videoUrl ? <video key={videoUrl} className="yt-video" controls src={videoUrl} aria-label="완성 영상" /> : null}
      {videoUrl ? <small>보기 주소는 10분 동안 열립니다. 재생이 멈추면 ‘영상 다시 열기’를 눌러 주세요.</small> : null}
      <small>확인한 의견은 OS 문서 ‘유튜브 영상 자동화’ 폴더에 새 요청 문서로 남겨 주세요(분:초와 함께). 다음은 ④ 제목·썸네일입니다.</small>
    </Step>
  </div>;
}
