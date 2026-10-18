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
interface StaffJob { id: string; status: string; requestedAt: string; claimedAt: string | null; model: string | null; issues: string[]; failReason: string | null; processing: boolean; targetMinutes?: number | null }
export interface StaffJobStatus { job: StaffJob | null; myAi: { keys: number; lastUsedAt: string | null } }
interface RenderPc { state: "online" | "offline" | "unknown"; ageSeconds: number | null; diskFreeGb: number | null; lowDisk: boolean; job: { step: string } | null; queue: { voice: number; render: number }; averageRenderMinutes: number | null }
interface StoredPlan {
  inputKey?: string; templateVersion?: string; generatedAt?: string; unresolvedAcknowledged?: { by?: string; count?: number }; author?: { type?: string; model?: string };
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
  return { label: "영상 제작 대기", tone: "progress", detail: run.render?.lastErrorCode ? `한 번 실패해 다시 시도합니다(오류 코드 ${run.render.lastErrorCode}).` : "렌더 PC가 차례대로 가져가 만듭니다." };
}
const PHASE_PILL = { progress: "scheduled", ready: "approved", problem: "failed" } as const;
const ago = (seconds: number) => seconds < 90 ? `${seconds}초` : seconds < 5400 ? `${Math.round(seconds / 60)}분` : `${Math.round(seconds / 3600)}시간`;
const sinceIso = (iso: string | null) => iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000)) : null;
const RENDER_STEP: Record<string, string> = { voice: "목소리 만드는 중", download: "음성 받는 중", narration: "음성 잇는 중", drawing: "영상 그리는 중", upload: "영상 올리는 중" };
// What staff paste into their own Claude or Codex once (the OS connection is set up with a personal agent key).
const MY_AI_PROMPT = "브랜디 OS 연결 도구로 list_youtube_ai_jobs를 실행해 내 작업을 확인하고, 작업이 있으면 process_youtube_ai_job으로 하나씩 claim → 받은 지시대로 처리 → complete 하세요. 작업이 없으면 끝내세요.";

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
  const [designValid, setDesignValid] = useState<boolean | null>(null);
  const [runs, setRuns] = useState<VoiceRun[] | null>(null);
  const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState(""); const [segmentUrl, setSegmentUrl] = useState(""); const [videoUrl, setVideoUrl] = useState("");
  const [notesRead, setNotesRead] = useState(false);
  const [staff, setStaff] = useState<StaffJobStatus | null>(null);
  const [renderPc, setRenderPc] = useState<RenderPc | null>(null);
  const isAdmin = profile?.role === "admin";

  const load = useCallback(async () => {
    try {
      const automation = await apiRequest<{ plan: YoutubeAutomationPlan; designValid: boolean | null; voicePreviewConfigured: boolean }>(`/api/v1/content/youtube-automation?sourceId=${encodeURIComponent(sourceId)}`, { token: accessToken });
      setPlan(automation.plan); setDesignValid(automation.designValid ?? null); setPreviewConfigured(automation.voicePreviewConfigured); setAvailable(true);
    } catch { setAvailable(false); return; }
    try { setRuns((await apiRequest<{ runs: VoiceRun[] }>(`/api/v1/content/youtube-automation/runs?sourceId=${encodeURIComponent(sourceId)}`, { token: accessToken })).runs); }
    catch { setRuns(null); }
    // Staff AI job (화면 설계) and render PC status are extra information: a failure only hides them.
    await Promise.all([
      apiRequest<StaffJobStatus>(`/api/v1/content/youtube-automation/ai-jobs?sourceId=${encodeURIComponent(sourceId)}`, { token: accessToken }).then(setStaff, () => setStaff(null)),
      apiRequest<RenderPc>("/api/v1/content/youtube-automation/render-pc", { token: accessToken }).then(setRenderPc, () => setRenderPc(null)),
    ]);
  }, [accessToken, sourceId]);
  useEffect(() => { setPreviewUrl(""); setSegmentUrl(""); setVideoUrl(""); setNotesRead(false); void load(); }, [load]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const latest = runs?.[0];
  const phase = latest ? runPhase(latest) : null;
  const staffPending = staff?.job ? ["backlog", "active"].includes(staff.job.status) : false;
  const working = phase?.tone === "progress" || staffPending;
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
  const storedForInput = Boolean(stored && plan.inputKey && stored.inputKey === plan.inputKey && stored.templateVersion === YOUTUBE_VISUAL_TEMPLATE_VERSION);
  // A design that no longer passes today's deck rules counts as missing: it can't be rendered again.
  const outdatedDesign = storedForInput && designValid === false;
  const design = storedForInput && !outdatedDesign ? stored!.plan ?? null : null;
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
      <p>내 AI(Claude 또는 Codex)가 원고를 읽고 단락마다 도식 하나와 화면에 나올 짧은 문구, 위쪽 막대에 보일 섹션을 정하고, 목소리로 읽기 어려운 곳이 없는지 봅니다.</p>
      {outdatedDesign ? <p className="yt-note yt-warn"><strong>다시 설계 필요</strong> 저장된 화면 설계가 지금 도식 규칙(항목 수 · 글자 수)에 맞지 않아 새로 만들 수 없어요. 내 AI에 다시 보내 주세요. 이미 완성된 영상은 그대로 볼 수 있어요.</p> : null}
      {!design && scriptReady ? <StaffDesign status={staff} busy={Boolean(busy)} onSend={() => void act("design", () => post("/ai-jobs", "POST", { task: "scene-plan" }))} /> : null}
      {design ? <>
        {stored?.author?.type === "staff_ai" ? <small>직원 AI가 설계 · {stored.author.model ?? "모델 이름 없음"} (AI가 적은 이름)</small> : null}
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
      <p>대표 목소리 음성을 만들고, 이어서 마인드맵 영상을 만들어 비공개로 저장합니다. 늘 켜 둔 렌더 PC가 차례대로 만듭니다.</p>
      {renderPc ? <RenderPcLine status={renderPc} /> : null}
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

/** 화면 설계 by the requester's own AI: send, then the job's state in words (대기 · 처리 중 · 확인 필요 · 못 함). */
/** [내 AI에 보내기] and where the job stands; shared by ② 원고 and ③ 화면 설계. */
export function StaffDesign({ status, busy, onSend }: { status: StaffJobStatus | null; busy: boolean; onSend: () => void }) {
  const job = status?.job;
  const lastSeen = sinceIso(status?.myAi.lastUsedAt ?? null);
  const connected = (status?.myAi.keys ?? 0) > 0;
  const open = job && ["backlog", "active"].includes(job.status);
  const send = <div className="yt-actions">
    <button type="button" className="primary-button" disabled={busy} onClick={onSend}>{busy ? "보내는 중…" : job?.status === "blocked" ? "내 AI에 다시 보내기" : "내 AI에 보내기"}</button>
    <small>내 AI 요금제로 처리해 회사 AI 비용이 들지 않습니다.</small>
  </div>;
  return <>
    {!open ? send : null}
    {job?.status === "backlog" ? <div className="yt-run"><div className="yt-run-head"><span className="status-pill" data-status="waiting">대기</span>
      <small>{lastSeen === null ? "내 AI가 아직 OS를 확인한 적이 없어요." : `내 AI가 ${ago(lastSeen)} 전에 마지막으로 확인했어요. 다음 확인 때 가져가요.`}</small></div></div> : null}
    {job?.status === "active" && !job.issues.length ? <div className="yt-run"><div className="yt-run-head"><span className="status-pill" data-status="scheduled">처리 중</span>
      <small>내 AI가 처리 중 · {ago(sinceIso(job.claimedAt) ?? 0)}째</small></div></div> : null}
    {job?.status === "active" && job.issues.length ? <div className="yt-note yt-warn"><strong>확인 필요 · 검사에서 걸린 곳</strong>
      <ul className="yt-list">{job.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul><p>내 AI가 고쳐서 다시 제출하면 넘어갑니다.</p></div> : null}
    {job?.status === "blocked" ? <div className="yt-note yt-warn"><strong>못 함</strong><p>{job.failReason ?? "이유가 남지 않았어요."}</p></div> : null}
    {!connected || (open && (lastSeen === null || lastSeen > 30 * 60)) ? <details className="yt-details">
      <summary>{connected ? "내 AI가 30분 넘게 확인하지 않았어요 · 확인할 것" : "내 AI가 아직 연결되지 않았어요 · 연결 방법"}</summary>
      <ol className="yt-list">
        <li>관리자에게 내 이름으로 된 AI 접근 키와 OS 연결 주소를 받아, Claude(데스크톱 · Claude Code) 또는 Codex의 OS 연결에 넣습니다.</li>
        <li>내 AI에 아래 문장을 10분마다 실행하도록 맡깁니다. 컴퓨터가 켜져 있는 동안 처리돼요.</li>
        <li>확인했는데도 안 되면 키가 회수되지 않았는지 관리자에게 물어봐 주세요.</li>
      </ol>
      <p className="yt-note">{MY_AI_PROMPT}</p>
    </details> : null}
  </>;
}

/** 렌더 PC (Mac mini) on/off, what it is doing, the queue and disk, from its once-a-minute signal. */
function RenderPcLine({ status }: { status: RenderPc }) {
  const queue = status.queue.voice + status.queue.render;
  if (status.state === "unknown") return <p className="yt-note">렌더 PC가 아직 OS에 연결되지 않았어요. 연결되면 여기에 상태가 보여요.</p>;
  return <div className="yt-run">
    <div className="yt-run-head"><span className="status-pill" data-status={status.state === "online" ? "approved" : "failed"}>{status.state === "online" ? "렌더 PC 켜짐" : "렌더 PC 연결 끊김"}</span>
      <small>마지막 신호 {ago(status.ageSeconds ?? 0)} 전</small></div>
    <small>{status.state === "online" ? `지금: ${status.job ? RENDER_STEP[status.job.step] ?? "작업 중" : "쉬는 중"} · 기다리는 작업 ${queue}건${status.averageRenderMinutes ? ` · 영상 한 편 평균 ${status.averageRenderMinutes}분` : ""}`
      : "신호가 5분 넘게 없어요. 관리자가 렌더 PC 전원과 인터넷을 확인하면, 켜지는 대로 차례대로 이어서 만들어요."}</small>
    {status.lowDisk ? <p className="yt-note yt-warn">렌더 PC 디스크 여유가 {status.diskFreeGb}GB예요. 60GB 아래라 새 영상을 받지 않아요. 관리자가 공간을 비워 주세요.</p> : null}
  </div>;
}
