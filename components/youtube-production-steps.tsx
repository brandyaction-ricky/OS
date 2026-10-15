"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiRequest } from "@/lib/api-client";
import type { YoutubeAutomationPlan } from "@/lib/youtube-automation-plan";
import { MINDMAP_DECKS, YOUTUBE_VISUAL_TEMPLATE_VERSION, type MindmapDeck } from "@/lib/youtube-visual-template";
import { useSession } from "./session-provider";

interface Render { status: string; stage: string; lastErrorCode: string | null }
interface VoiceRun { id: string; status: string; stage: string; segmentCount: number; segmentsReady: number; readyIndexes: number[]; needsAttention: string[]; lastErrorCode: string | null; createdAt: string; render: Render | null }
interface StoredPlan {
  inputKey?: string; templateVersion?: string; generatedAt?: string; unresolvedAcknowledged?: { by?: string; count?: number };
  plan?: { sections?: string[]; scenes?: Array<{ segmentIndex: number; deck: MindmapDeck; items: string[]; section: number }>; unresolved?: string[] };
}
type StepState = "done" | "current" | "waiting";
const STEP_LABEL: Record<StepState, string> = { done: "완료", current: "할 차례", waiting: "대기" };

/** Where a run stands, in words staff can act on. */
function runPhase(run: VoiceRun): { label: string; tone: "progress" | "ready" | "problem"; detail: string } {
  if (run.render?.stage === "render_ready") return { label: "완성", tone: "ready", detail: "아래 4단계에서 영상을 볼 수 있습니다." };
  if (run.status === "blocked") return { label: "음성 확인 필요", tone: "problem", detail: run.needsAttention.length ? "아래 항목을 원고에서 고친 뒤 다시 시작해 주세요." : `오류 코드 ${run.lastErrorCode ?? "없음"}. 개발 담당에게 알려 주세요.` };
  if (run.render?.status === "blocked") return { label: "영상 제작 실패", tone: "problem", detail: `세 번 시도했지만 실패했습니다(오류 코드 ${run.render.lastErrorCode ?? "없음"}). 개발 담당에게 알려 주세요.` };
  if (run.stage !== "voice_ready") return { label: `음성 만드는 중 ${run.segmentsReady}/${run.segmentCount}단락`, tone: "progress", detail: "같은 원고면 기존 녹음을 다시 써서 바로 끝납니다." };
  if (run.render?.stage === "rendering") return { label: "영상 만드는 중", tone: "progress", detail: "10분 안팎 걸립니다. 이 화면은 자동으로 새로 고쳐집니다." };
  return { label: "영상 제작 대기", tone: "progress", detail: run.render?.lastErrorCode ? `한 번 실패해 다시 시도합니다(오류 코드 ${run.render.lastErrorCode}).` : "작업용 컴퓨터가 차례대로 가져가 만듭니다." };
}

function Step({ number, title, state, children }: { number: number; title: string; state: StepState; children: ReactNode }) {
  return <li className={`yt-step yt-step-${state}`} aria-current={state === "current" ? "step" : undefined}>
    <span className="yt-step-number" aria-hidden="true">{state === "done" ? "✓" : number}</span>
    <div className="yt-step-body">
      <header><h4>{number}. {title}</h4><span className="yt-step-state">{STEP_LABEL[state]}</span></header>
      {children}
    </div>
  </li>;
}

/**
 * The narrated-video steps for one content item, in the order staff follow them:
 * approved script → AI screen design → voice and video → watch. Each step says what it needs next.
 */
export function YoutubeProductionSteps({ sourceId, storedPlan, onChange }: { sourceId: string; storedPlan: unknown; onChange: () => Promise<void> }) {
  const { accessToken, profile } = useSession();
  const [available, setAvailable] = useState(false);
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
  const working = Boolean(latest && runPhase(latest).tone === "progress");
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

  if (!available || !plan) return null;
  const stored = (storedPlan ?? null) as StoredPlan | null;
  const design = stored && plan.inputKey && stored.inputKey === plan.inputKey && stored.templateVersion === YOUTUBE_VISUAL_TEMPLATE_VERSION ? stored.plan : null;
  const notes = design?.unresolved ?? [];
  const notesDone = Boolean(design) && (!notes.length || (stored?.unresolvedAcknowledged?.by === profile?.id && stored?.unresolvedAcknowledged?.count === notes.length));
  const scriptReady = Boolean(plan.inputKey) && !plan.missing.length;
  const madeForDesign = latest && stored?.generatedAt && Date.parse(latest.createdAt) >= Date.parse(stored.generatedAt) ? latest : undefined;
  const videoReady = Boolean(runs?.some((run) => run.render?.stage === "render_ready"));
  const phase = latest ? runPhase(latest) : null;
  const sections = design?.sections ?? [];
  const states: StepState[] = [
    scriptReady ? "done" : "current",
    !scriptReady ? "waiting" : notesDone ? "done" : "current",
    !notesDone ? "waiting" : madeForDesign?.render?.stage === "render_ready" ? "done" : "current",
    videoReady ? "done" : "waiting",
  ];

  return <section className="panel yt-steps" aria-label="영상 자동 제작">
    <header className="yt-steps-header">
      <div><h3>영상 자동 제작</h3><p>승인된 원고로 대표 목소리 내레이션과 마인드맵 영상을 만듭니다. 영상은 비공개로 저장되고 유튜브에 자동으로 올라가지 않습니다.</p></div>
      <button type="button" className="ghost-button" disabled={Boolean(busy)} onClick={() => void act("reload", load, false)}>상태 새로 보기</button>
    </header>
    {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
    {!isAdmin ? <p className="yt-note">제작 실행은 콘텐츠를 맡은 관리자만 할 수 있습니다. 진행 상황과 완성 영상은 볼 수 있습니다.</p> : null}
    <ol className="yt-step-list">
      <Step number={1} title="원고 준비" state={states[0]}>
        {scriptReady ? <p>승인된 원고와 제목·썸네일이 연결됐습니다.</p> : <>
          <p>이 화면의 제작 공정에서 아래 항목을 먼저 마쳐 주세요.</p>
          <ul className="yt-checklist">{plan.missing.map((item) => <li key={item}>{item}</li>)}</ul>
        </>}
        {scriptReady && isAdmin && previewConfigured ? <div className="yt-actions">
          <button type="button" className="ghost-button" disabled={Boolean(busy)} onClick={() => void previewVoice()}>{busy === "preview" ? "목소리 만드는 중…" : "첫 단락 목소리 미리듣기"}</button>
        </div> : null}
        {previewUrl ? <audio controls src={previewUrl} aria-label="첫 단락 목소리 미리듣기" /> : null}
      </Step>

      <Step number={2} title="화면 설계" state={states[1]}>
        <p>AI가 원고를 읽고 단락마다 도식 하나와 화면에 나올 짧은 문구, 위쪽 막대에 보일 섹션을 정합니다.</p>
        {!design && scriptReady ? <div className="yt-actions">
          <button type="button" className="primary-button" disabled={Boolean(busy) || !isAdmin} onClick={() => void act("design", () => post("/scenes", "POST", {}))}>
            {busy === "design" ? "설계하는 중… (1분 정도)" : "화면 설계 만들기"}
          </button>
          <small>AI 사용료가 한 번 듭니다.</small>
        </div> : null}
        {design ? <>
          <p className="yt-summary"><strong>{design.scenes?.length ?? 0}단락</strong> · 섹션 {sections.length}개 <span className="yt-chips">{sections.map((name, index) => <span key={`${index}-${name}`} className="yt-chip">{name}</span>)}</span></p>
          <details className="yt-details">
            <summary>단락별 화면 보기</summary>
            <div className="yt-table" role="table" aria-label="단락별 화면 설계">
              <div role="row" className="yt-table-head"><span role="columnheader">단락</span><span role="columnheader">도식</span><span role="columnheader">화면 문구</span><span role="columnheader">섹션</span></div>
              {design.scenes?.map((scene) => <div role="row" key={scene.segmentIndex}>
                <span role="cell">{scene.segmentIndex + 1}</span>
                <span role="cell">{MINDMAP_DECKS[scene.deck]?.name ?? scene.deck}</span>
                <span role="cell">{scene.items.join(" · ")}</span>
                <span role="cell">{sections[scene.section]}</span>
              </div>)}
            </div>
          </details>
          {notes.length ? <div className={`yt-notes ${notesDone ? "yt-notes-done" : ""}`}>
            <strong>AI가 남긴 확인할 점 {notes.length}개</strong>
            <ul>{notes.map((note) => <li key={note}>{note}</li>)}</ul>
            {notesDone ? <p>확인 기록이 저장됐습니다.</p> : isAdmin ? <div className="yt-actions">
              <label className="yt-check"><input type="checkbox" checked={notesRead} onChange={(event) => setNotesRead(event.target.checked)} />위 내용을 읽었고, 이대로 제작해도 됩니다.</label>
              <button type="button" className="primary-button" disabled={Boolean(busy) || !notesRead} onClick={() => void act("ack", () => post("/scenes", "PATCH", { acknowledgeUnresolved: true }))}>확인 완료</button>
            </div> : <p>관리자가 확인하면 다음 단계로 넘어갑니다.</p>}
          </div> : null}
        </> : null}
      </Step>

      <Step number={3} title="음성·영상 제작" state={states[2]}>
        <p>대표 목소리 음성을 만들고, 이어서 마인드맵 영상을 만들어 비공개로 저장합니다. 영상은 작업용 컴퓨터가 켜져 있을 때 만들어집니다.</p>
        {notesDone && !madeForDesign ? <div className="yt-actions">
          <button type="button" className="primary-button" disabled={Boolean(busy) || !isAdmin} onClick={() => void act("run", () => post("/runs", "POST", {}))}>
            {busy === "run" ? "등록하는 중…" : "제작 시작"}
          </button>
          <small>같은 원고면 기존 녹음을 다시 써서 음성 비용이 들지 않습니다.</small>
        </div> : null}
        {latest && phase ? <div className={`yt-run yt-run-${phase.tone}`} role="status">
          <div className="yt-run-head"><strong>{phase.label}</strong><small>{new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(latest.createdAt))} 시작</small></div>
          {phase.tone === "progress" && latest.stage !== "voice_ready" ? <progress max={latest.segmentCount} value={latest.segmentsReady} aria-label="음성 진행" /> : null}
          <p>{phase.detail}</p>
          {latest.needsAttention.length ? <ul>{latest.needsAttention.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
          {!madeForDesign ? <p>이 기록은 지금 화면 설계보다 먼저 만든 것입니다. 새 설계로 만들려면 위 “제작 시작”을 눌러 주세요.</p> : null}
        </div> : null}
        {latest?.readyIndexes.length ? <details className="yt-details">
          <summary>단락별 음성 듣기</summary>
          <div className="yt-segments">{latest.readyIndexes.map((index) => <button type="button" className="ghost-button" disabled={Boolean(busy)} key={index} onClick={() => void listen(latest.id, index)}>{index + 1}단락</button>)}</div>
          {segmentUrl ? <audio key={segmentUrl} controls autoPlay src={segmentUrl} aria-label="단락 음성 듣기" /> : null}
        </details> : null}
        {runs === null ? <p className="yt-note">제작 기록은 콘텐츠 담당자만 볼 수 있습니다.</p> : null}
      </Step>

      <Step number={4} title="완성 영상 확인" state={states[3]}>
        {!videoUrl ? <p>{videoReady ? "가장 최근에 완성된 영상을 이 화면에서 바로 볼 수 있습니다." : "영상이 완성되면 여기서 볼 수 있습니다."}</p> : null}
        <div className="yt-actions">
          <button type="button" className={videoReady && !videoUrl ? "primary-button" : "secondary-button"} disabled={Boolean(busy) || (!videoReady && runs !== null)} onClick={() => void openVideo()}>
            {busy === "video" ? "여는 중…" : videoUrl ? "영상 다시 열기" : "영상 보기"}
          </button>
          {videoUrl ? <a className="secondary-button" href={`${videoUrl}${videoUrl.includes("?") ? "&" : "?"}download=${encodeURIComponent(`${sourceId}.mp4`)}`}>내려받기</a> : null}
        </div>
        {videoUrl ? <video key={videoUrl} className="yt-video" controls src={videoUrl} aria-label="완성 영상" /> : null}
        {videoUrl ? <small>보기 주소는 10분 동안 열립니다. 재생이 멈추면 “영상 다시 열기”를 눌러 주세요.</small> : null}
        <small>확인한 의견은 OS 문서 ‘유튜브 영상 자동화’ 폴더에 새 요청 문서로 남겨 주세요(분:초와 함께).</small>
      </Step>
    </ol>
  </section>;
}
