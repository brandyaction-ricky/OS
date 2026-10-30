"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { apiRequest, ApiRequestError } from "@/lib/api-client";
import { useSession } from "./session-provider";
import { StaffDesign, Step, type StaffJobStatus, type StepState } from "./youtube-production-steps";
import "./youtube-production-steps.css";
import { CostTag, useCostConfirm, useCostModels, voiceEstimate } from "./cost-notice";
import { MyinSoundEditor } from "./myin-sound-editor";
import { MyinOurImages } from "./myin-our-images";
import { MyinScreenCheck } from "./myin-screen-check";
import { MyinVoiceCheck, type MyinVoiceCheckView, type MyinVoiceFixView } from "./myin-voice-check";
import { DraftPlacePicker, localBlocker, useLocalRender, type DraftPlace } from "./myin-local-render";
import { assToSrt } from "@/lib/subtitle-files";

interface Storyboard { scenes: number; model: string; at: string; metaphors: { scene: number; type: string; at: string }[]; cta: { after: string; line: string }[];
  summary: { title: string; points: string[] } | null; reasons: { metaphors: string; cta: string; summary: string };
  assets: { kind: string; file: string; url: string; source: string; license: string; use: string }[]; fuzzy: string[]; notes: string[] }
interface MyinRun { id: string; status: string; stage: string; layout?: "short" | null; paragraphs: number; paragraphsReady: number; voiceOnPc?: boolean; lastErrorCode: string | null;
  words: { words: number; subtitleLines: number; durationSeconds: number } | null; storyboard: Storyboard | null;
  review: { decision: "confirmed" | "revise"; name: string; note: string; at: string } | null;
  assetDecisions: Record<string, { decision: "approved" | "excluded" }>; ctaReady: string | null;
  prepared: { misses: string[]; sheets: number; credits: string[]; at: string } | null;
  clips: { name: string; label: string }[] | null; clipsReview: { name: string; note: string; at: string } | null;
  final: { bytes: number; durationSeconds: number; lufs: number; peak: number; at: string } | null; scriptChanged?: boolean; workingSince?: string | null;
  sound: { report: string; at: string; edited?: { name: string; at: string } } | null; local: { by: string; name: string } | null; localReady: boolean;
  voiceFixes?: MyinVoiceFixView[]; voiceCheck?: MyinVoiceCheckView | null; voiceFixable?: boolean; voiceChanged?: { at: string; count: number } | null }
interface Outputs { clips: { label: string; url: string | null }[]; video: string | null; summary: string | null; deck: string | null; srt: string | null }

const PHASE: Record<string, string> = { breath_pending: "영상 만드는 컴퓨터가 숨 자리 고르는 중", voice_pending: "음성 만드는 중", words_pending: "영상 만드는 컴퓨터가 받아쓰기·자막 만드는 중", words_ready: "받아쓰기·자막 완료",
  storyboard_review: "기획표 확인 대기 (로건, 유쓰)", storyboard_confirmed: "기획표 확인 완료", cta_pending: "구독 대사 음성 만드는 중",
  prep_pending: "영상 만드는 컴퓨터가 자료 준비·미리보기 점검 중", prep_ready: "미리보기 점검 끝", clips_pending: "영상 만드는 컴퓨터가 미리보기 영상 만드는 중",
  clips_review: "미리보기 확인 대기 (로건, 유쓰)", final_pending: "영상 만드는 컴퓨터가 전체 영상 만드는 중", final_ready: "완성" };
// 로건 피드백 10/26-8: how long each render-PC step usually takes on the Mac mini; past 1.5× the screen says to check.
// Preview clips scale with the storyboard: one per metaphor scene plus the opening, about 1.5 minutes each (2026-10-26: 31 clips, 45 minutes).
// ponytail: estimates, no per-scene progress — that needs the render PC to report it.
// words: +4 min since 로건 호흡·타이밍 (2026-10-27) re-times the gaps between sentences with a transcription.
// final: about 8 minutes per minute of video at 60 fps (2026-10-28: 52 minutes for 13 minutes at 30 fps; 60 fps from 2026-10-29).
const TYPICAL_MIN: Record<string, number> = { words_pending: 10, prep_pending: 5 };
const finalMinutes = (run: MyinRun) => Math.ceil((run.words?.durationSeconds ?? 780) / 60 * 5);   // 60fps, 5-second pieces: a 13-minute video ≈ 1 hour on the Mac mini (2026-10-29 test)
// ponytail: a 숏폼's minutes are guesses from the A1 pilot (40 s, one draft of the whole short); measure after the first ones.
const SHORT_MIN: Record<string, number> = { words_pending: 6, prep_pending: 3, clips_pending: 5, final_pending: 8 };
const typicalMinutes = (run: MyinRun) => run.voiceOnPc && run.stage === "words_pending" ? (run.layout === "short" ? 8 : 10 + Math.ceil(run.paragraphs / 4))
  : run.layout === "short" ? SHORT_MIN[run.stage] : run.stage === "clips_pending" ? Math.ceil(((run.storyboard?.metaphors.length ?? 0) + 1) * 1.5)
  : run.stage === "final_pending" ? finalMinutes(run) : TYPICAL_MIN[run.stage];
// What a stop means, so a staff member knows whether pressing again can help (2026-10-26: three presses hit the same stop).
const STOP: Record<string, string> = {
  WORKER_STAGE_FAILED: "영상 만드는 컴퓨터의 프로그램이 도중에 멈췄어요. 다시 해도 같은 이유로 멈출 수 있어요 — 다시 하기 전에 OS 담당자에게 알려 주세요.",
  WORKER_DOWNLOAD_FAILED: "영상 만드는 컴퓨터가 사진이나 음성 파일을 받지 못했어요. 사진 주소를 확인하거나 OS 담당자에게 알려 주세요.",
  MYIN_RUN_STALE: "원고가 바뀌었어요. v13 음성을 다시 시작해 주세요.",
};
// 2026-10-27 대표: ③ 시안 → ④ 자료 준비(사진 확정 · 구독 대사 · 사운드) → ⑤ 최종 시안. The same stages run twice: before the drafts are
// confirmed (clipsReview empty) the preparation is the ③ draft one, after it the ④ one.
// 내 컴퓨터로 시안 (2026-10-27): the ③ drafts of a run sent to a member's own Mac name that computer instead of the render PC.
const maker = (run: MyinRun) => run.local && !run.clipsReview ? `${run.local.name}님 컴퓨터` : "영상 만드는 컴퓨터";
// 로건 사람 말투 음성 (2026-10-29): the render PC makes the voice too — about 13 seconds a paragraph before the transcription.
const phaseLabel = (run: MyinRun) => run.voiceOnPc && run.stage === "words_pending" ? "영상 만드는 컴퓨터가 음성 · 받아쓰기 · 자막 만드는 중"
  : run.stage === "prep_pending" ? run.clipsReview ? "영상 만드는 컴퓨터가 자료 준비 · 다시 점검 중" : `${maker(run)}가 미리보기 준비 · ${run.layout === "short" ? "" : "자동 선곡 · "}점검 중`
  : run.stage === "clips_pending" ? `${maker(run)}가 미리보기 영상 만드는 중`
  : run.stage === "prep_ready" ? run.clipsReview ? "자료 준비 끝 · 사운드 확인 대기" : "미리보기 점검 끝" : PHASE[run.stage] ?? run.stage;

const KIND: Record<string, string> = { people: "인물 사진", situations: "상황 사진", bgm: "음악" };

/** The stage pill, with how long the render PC has been at it, or what a stop means. */
function RunState({ run }: { run: MyinRun }) {
  const minutes = run.workingSince ? Math.max(0, Math.floor((Date.now() - Date.parse(run.workingSince)) / 60_000)) : null;
  const typical = typicalMinutes(run);
  const started = run.workingSince ? new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date(run.workingSince)) : "";
  return <>
    <span className="status-pill" data-status={run.status === "blocked" ? "failed" : "scheduled"}>{run.status === "blocked" ? `멈춤 · 오류 코드 ${run.lastErrorCode ?? "없음"}` : phaseLabel(run)}</span>
    {run.status === "blocked" ? STOP[run.lastErrorCode ?? ""] ? <small>{STOP[run.lastErrorCode ?? ""]}</small> : null
      : minutes !== null ? <small>시작 {started} · {minutes}분째{typical ? minutes > typical * 1.5 ? " · 평소보다 오래 걸려요(확인 필요)" : ` · 보통 ${typical}분쯤 걸려요${run.stage === "clips_pending" && run.layout !== "short" ? `(미리보기 ${(run.storyboard?.metaphors.length ?? 0) + 1}개)` : ""}` : ""}</small>
      : typical && run.status === "backlog" ? <small>{maker(run)} 차례를 기다리는 중</small> : null}
  </>;
}
const when = (iso: string) => new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/**
 * ③ 영상 제작: every new video is made in Logan's 마이인 v13 format (owner decision 2026-10-19) — voice and subtitles, the staff AI's
 * storyboard and its confirmation, the drafts (2026-10-27: before the paid CTA voice and the sound pass), then the finished video and handouts. Where the pilot is closed
 * (production today) it says so instead.
 */
export function MyinV13Panel({ sourceId, finalNote, embedded = false, onFinal, voiceText, title = "", short = false }: { sourceId: string; finalNote?: ReactNode; embedded?: boolean; onFinal?: () => void;
  /** The video name, for downloaded file names. */ title?: string;
  /** The spoken paragraphs, for the company-money estimate shown before the voice is made (owner request 2026-10-25). */ voiceText?: string;
  /** 숏폼 (2026-10-28): drawn 9:16 by the render PC — no music, 구독 대사 or handouts, and its ④ goes straight on to the full video. */ short?: boolean }) {
  const cost = useCostConfirm(), { myinVoice } = useCostModels();
  // Fish drama-3 bills by the bytes it reads; ask before a new script is voiced, and before the storyboard's 구독 요청 lines are.
  const askVoice = async (text: string, again: string, takes = false) => {
    if (!text.trim()) return true;
    const estimate = voiceEstimate(text, myinVoice);
    // 영상 만드는 컴퓨터가 음성을 만들면 끊긴 문장을 한 번 더 만들어 고른다(로건 2026-10-29): 많게는 두 배.
    return cost.confirm({ model: myinVoice, amount: estimate.krw, detail: `${estimate.chars.toLocaleString("ko-KR")}자 · ${takes ? "끊긴 문장은 한 번 더 만들어 많게는 2배 · " : ""}${again}`, ok: "확인하고 만들기" });
  };
  const { accessToken } = useSession();
  const [run, setRun] = useState<MyinRun | null>(null);
  const [job, setJob] = useState<StaffJobStatus | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [voiceOnPc, setVoiceOnPc] = useState(false);
  const [busy, setBusy] = useState("");
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [qc, setQc] = useState("");
  const [note, setNote] = useState("");
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheetsOpen, setSheetsOpen] = useState(false);
  const [outputs, setOutputs] = useState<Outputs | null>(null);
  const lastStage = useRef<string | null>(null);
  // The clips' and video's signed addresses are asked for again only when they change or near their 30 minutes: a new address on every
  // 20-second poll made the browser download every clip again (2026-10-29: about 970 times a clip a day, most of the OS's egress).
  const outputsFor = useRef({ key: "", at: 0 });
  const [place, setPlace] = useState<DraftPlace>("pc");
  const draftWaiting = Boolean(run && !run.clipsReview && ["prep_pending", "clips_pending"].includes(run.stage));
  const { status: localPc, reload: reloadLocal } = useLocalRender(accessToken, run?.stage === "storyboard_review" || draftWaiting);
  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const loaded = await apiRequest<{ run: MyinRun | null; voiceOnPc?: boolean }>(`/api/v1/content/youtube-automation/myin?sourceId=${sourceId}`, { token: accessToken });
      const next = loaded.run;
      setRun(next); setAvailable(true); setVoiceOnPc(Boolean(loaded.voiceOnPc));
      // A final that appears while the screen is open tells the page (제작 counts it as a new version).
      if (next?.stage === "final_ready" && lastStage.current && lastStage.current !== "final_ready") onFinal?.();
      lastStage.current = next?.stage ?? null;
      const key = next?.clips || next?.final ? `${next.id}:${(next.clips ?? []).map((clip) => clip.name).join(",")}:${next.final?.at ?? ""}` : "";
      if (key && (key !== outputsFor.current.key || Date.now() - outputsFor.current.at > 20 * 60_000)) {
        setOutputs(await apiRequest<Outputs>(`/api/v1/content/youtube-automation/myin?outputs=${next!.id}`, { token: accessToken }));
        outputsFor.current = { key, at: Date.now() };
      }
      if (next?.words) setJob(await apiRequest<StaffJobStatus>(`/api/v1/content/youtube-automation/ai-jobs?sourceId=${sourceId}&task=storyboard`, { token: accessToken }));
    } catch (reason) { if (reason instanceof ApiRequestError && reason.status === 404) setAvailable(false); }
  }, [accessToken, sourceId, onFinal]);
  useEffect(() => { void load(); }, [load]);
  const working = Boolean(run && (["breath_pending", "voice_pending", "words_pending", "cta_pending", "prep_pending", "clips_pending", "final_pending"].includes(run.stage) && run.status !== "blocked" || (job?.job && ["backlog", "active"].includes(job.job.status))));
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
  // 1단계 파일 내려받기 (owner request 2026-10-28): the processed voice joined from its parts, and the subtitles as SRT or as Logan's ASS.
  const download = async (kind: "voice" | "srt" | "ass") => {
    if (!run) return;
    setSaving(kind); setError("");
    try {
      const files = await apiRequest<{ voice: { urls: string[]; bytes: number } | null; wordsUrl: string }>(`/api/v1/content/youtube-automation/myin?downloads=${run.id}`, { token: accessToken });
      const name = (title.replace(/[\\/:*?"<>|]/g, " ").trim() || "영상").slice(0, 60);
      let file: Blob;
      if (kind === "voice") {
        if (!files.voice) throw new Error("이 영상은 음성 파일이 아직 OS에 없어요.");
        const parts: ArrayBuffer[] = [];
        for (const [n, url] of files.voice.urls.entries()) {
          setSaving(`voice ${n + 1}/${files.voice.urls.length}`);
          const response = await fetch(url);
          if (!response.ok) throw new Error("음성 파일을 받지 못했어요. 다시 눌러 주세요.");
          parts.push(await response.arrayBuffer());
        }
        file = new Blob(parts, { type: "audio/wav" });
        if (file.size !== files.voice.bytes) throw new Error("음성 파일이 다 받아지지 않았어요. 다시 눌러 주세요.");
      } else {
        const response = await fetch(files.wordsUrl);
        if (!response.ok) throw new Error("자막 파일을 받지 못했어요. 다시 눌러 주세요.");
        const ass = String(((await response.json()) as { subtitlesAss?: string }).subtitlesAss ?? "");
        file = new Blob([kind === "srt" ? assToSrt(ass) : ass], { type: "text/plain;charset=utf-8" });
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(file);
      link.download = `${name} ${kind === "voice" ? "음성.wav" : kind === "srt" ? "자막.srt" : "방송 자막.ass"}`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "파일을 내려받지 못했어요."); }
    finally { setSaving(""); }
  };

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
  // 화면 자동 검사 › 장면 #n: open the sheets and go to the one that holds the scene.
  const showSheet = async (n: number) => {
    setSheetsOpen(true);
    if (!sheets.length) await showSheets();
    window.setTimeout(() => document.getElementById(`yt-sheet-${n}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
  };
  const phase = run ? run.status === "blocked" ? `멈춤 · 오류 코드 ${run.lastErrorCode ?? "없음"}` : phaseLabel(run) : null;
  const board = run?.storyboard;

  const step1: StepState = run?.words && !run.scriptChanged ? "done" : "current";
  const step2: StepState = !run?.words ? "waiting" : run.review?.decision === "confirmed" ? "done" : "current";
  const materials = Boolean(run?.clipsReview);   // ③ drafts confirmed: the ④ preparation and the full video
  const step3: StepState = run?.review?.decision !== "confirmed" ? "waiting" : materials ? "done" : "current";
  const step4: StepState = !run || !materials ? "waiting" : ["final_pending", "final_ready"].includes(run.stage) ? "done" : "current";
  const step5: StepState = run?.stage === "final_ready" ? "done" : run?.stage === "final_pending" ? "current" : "waiting";
  const assetsUsed = board ? board.assets.filter((a) => run?.assetDecisions[a.file]?.decision === "approved") : [];

  return <div className="yt-steps" role="region" aria-label="마이인 영상 만들기">
    {cost.element}
    {embedded ? null : <section className="panel">
      <header className="panel-header"><div><span className="eyebrow">마이인 형식 · 로건님 v13</span><h2>영상 만들기</h2>
        <p>승인된 원고로 대표 목소리를 만들고, 영상 만드는 컴퓨터가 받아쓰기·자막을 만듭니다. 내 AI가 장면 기획표를 쓰고 로건, 유쓰가 기획표와 미리보기를 확인하면, 구독 대사 · 사운드를 준비한 뒤 영상 만드는 컴퓨터가 완성 영상과 한 장 정리·덱 PDF·자막 파일을 만들어 올립니다.</p></div></header>
    </section>}

    <Step index={0} state={step1} title="음성과 받아쓰기·자막" idBase="myin-step">
      <p>{short ? "확정한 대본을 대표 목소리로 읽고, 영상 만드는 컴퓨터가 받아쓰기와 자막을 만들어요." : "승인된 원고를 대표 목소리(drama-3)로 만들고, 영상 만드는 컴퓨터가 로건님 방식대로 다듬어 받아쓰기와 방송 자막을 만듭니다."}</p>
      {run?.scriptChanged ? <p className="yt-note yt-warn">{short ? "확정한 대본이 바뀌었어요. 아래 작업은 옛 대본으로 만든 것이라 더 진행되지 않아요. 새로 만들면 기획표와 미리보기 확인도 다시 거쳐요." : "구성안 원고가 바뀌었어요. 아래 작업은 옛 원고로 만든 것이라 더 진행되지 않아요. 새로 만들면 기획표와 미리보기 확인도 다시 거쳐요."}</p> : null}
      {!run || (run.status === "blocked" && !run.words) || run.scriptChanged ? <div className="yt-actions">
        <button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => void (async () => { if (run && !run.scriptChanged || await askVoice(voiceText ?? "", "같은 원고로 다시 누르면 들지 않아요", voiceOnPc)) await act("start", () => post("/myin", "POST", { sourceId })); })()}>{busy === "start" ? "시작하는 중…" : run?.scriptChanged ? short ? "바뀐 대본으로 음성 다시 만들기" : "바뀐 원고로 v13 음성 다시 만들기" : run ? short ? "음성 다시 시작" : "v13 음성 다시 시작" : short ? "음성 만들기" : "v13 음성 만들기"}</button>
        <small><CostTag kind="paid" /> 같은 {short ? "대본" : "원고"}으로 다시 누르면 만든 음성을 이어 써요.</small>
      </div> : null}
      {run ? <div className="yt-run">
        <div className="yt-run-head"><span className="status-pill" data-status={run.status === "blocked" && !run.words ? "failed" : run.words && !run.voiceFixes?.length ? "approved" : "scheduled"}>{run.voiceFixes?.length && run.stage === "words_pending" ? "고친 곳 다시 만드는 중" : run.words ? "받아쓰기·자막 완료" : phase}</span>
          {run.voiceOnPc ? <small>음성 {run.paragraphs}문단 · 영상 만드는 컴퓨터가 문장마다 만들어 고름</small> : <small>음성 {run.paragraphsReady}/{run.paragraphs}문단</small>}</div>
        {run.stage === "voice_pending" ? <progress max={run.paragraphs} value={run.paragraphsReady} aria-label="음성 진행" /> : null}
        {run.words ? <small>낭독 {Math.floor(run.words.durationSeconds / 60)}분 {Math.round(run.words.durationSeconds % 60)}초 · 받아쓴 단어 {run.words.words.toLocaleString()}개 · 자막 {run.words.subtitleLines}줄</small> : null}
      </div> : null}
      {run?.words ? <div className="yt-actions">
        <button type="button" className="secondary-button compact" disabled={Boolean(saving) || !run.localReady} onClick={() => void download("voice")}>{saving.startsWith("voice") ? `음성 받는 중 ${saving.slice(6)}` : "음성 내려받기 (WAV)"}</button>
        <button type="button" className="secondary-button compact" disabled={Boolean(saving)} onClick={() => void download("srt")}>{saving === "srt" ? "받는 중…" : "자막 내려받기 (SRT)"}</button>
        <button type="button" className="secondary-button compact" disabled={Boolean(saving)} onClick={() => void download("ass")}>{saving === "ass" ? "받는 중…" : "방송 자막 내려받기 (ASS)"}</button>
        {!run.localReady ? <small>이 영상의 음성은 영상 만드는 컴퓨터가 OS에 올린 뒤 받을 수 있어요.</small> : null}
      </div> : null}
      {run?.words && run.voiceOnPc && !short ? <MyinVoiceCheck key={`${run.id}-${run.stage}-${run.voiceCheck?.at ?? ""}`} runId={run.id} stage={run.stage} fixable={Boolean(run.voiceFixable)} pending={run.voiceFixes ?? []} check={run.voiceCheck ?? null} token={accessToken} onChanged={load}
        askCost={(sentences) => cost.confirm({ model: myinVoice, amount: voiceEstimate("가".repeat(sentences * 120), myinVoice).krw, detail: `문장 ${sentences}개 · 문장마다 두 번 만들어 더 나은 것을 골라요`, ok: "확인하고 다시 만들기" })} /> : null}
      {run?.words ? <details className="yt-details" onToggle={(event) => { if ((event.target as HTMLDetailsElement).open && !qc) void showQc(); }}>
        <summary>자막 검사표 보기</summary>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 360, overflow: "auto", margin: 0 }}>{qc || "불러오는 중…"}</pre>
      </details> : null}
    </Step>

    <Step index={1} state={step2} title="장면 기획표 (내 AI → 로건, 유쓰 확인)" idBase="myin-step">
      {!run?.words ? <p>받아쓰기·자막이 끝나면 내 AI에 보낼 수 있습니다.</p> : null}
      {run?.stage === "words_ready" ? <>
        {run.review?.decision === "revise" ? <div className="yt-note yt-warn"><strong>로건, 유쓰 수정 요청 · {when(run.review.at)}</strong><p>{run.review.note}</p></div> : null}
        <p>{short ? "내 AI가 세로 화면 규칙과 세로 도식 목록으로 숏폼 기획표를 써요. 첫 화면에는 확정한 헤드 카피가 떠요." : "내 AI가 로건님 매뉴얼·기획표 문서와 음악 창고 목록을 읽고, 위 받아쓰기의 철자 그대로 장면 기획표와 사진 후보를 만듭니다. OS가 문구 위치와 형식을 검사합니다."}</p>
        <StaffDesign status={job} busy={busy === "send"} onSend={() => void act("send", () => post("/ai-jobs", "POST", { task: "storyboard", sourceId }))} />
      </> : null}
      {board && run && run.stage !== "words_ready" ? <>
        <div className="yt-run"><div className="yt-run-head"><span className="status-pill" data-status={run.review?.decision === "confirmed" ? "approved" : "review"}>{run.review?.decision === "confirmed" ? "로건, 유쓰 확인 완료" : "로건, 유쓰 확인 대기"}</span>
          <small>장면 {board.scenes}개 · 직원 AI {board.model} · {when(board.at)}</small></div></div>
        <details className="yt-details" open={run.stage === "storyboard_review"}><summary>{short ? "도식" : "비유 포인트"} {board.metaphors.length}곳</summary>
          <ul className="yt-list">{board.metaphors.map((m) => <li key={m.scene}>{m.scene}번 장면 · {m.type} · “{m.at}”</li>)}</ul>
          <p className="yt-note">{board.reasons.metaphors}</p></details>
        {short ? null : <><details className="yt-details" open={run.stage === "storyboard_review"}><summary>구독 요청 {board.cta.length}곳</summary>
          <ul className="yt-list">{board.cta.map((c) => <li key={c.after}>“{c.after}” 뒤 · {c.line}</li>)}</ul>
          <p className="yt-note">{board.reasons.cta}</p></details>
        <details className="yt-details" open={run.stage === "storyboard_review"}><summary>한 장 정리</summary>
          {board.summary ? <><strong>{board.summary.title}</strong><ul className="yt-list">{board.summary.points.map((p) => <li key={p}>{p}</li>)}</ul></> : <p>없음</p>}
          <p className="yt-note">{board.reasons.summary}</p></details></>}
        <details className="yt-details"><summary>사진 후보 {board.assets.filter((a) => a.kind !== "bgm").length}개</summary>
          <ul className="yt-list">{board.assets.filter((a) => a.kind !== "bgm").map((a) => <li key={a.file}>{KIND[a.kind] ?? a.kind} · {a.file} · {a.source} · {a.license} — {a.use} <a href={a.url} target="_blank" rel="noreferrer">출처</a></li>)}</ul></details>
        <MyinOurImages key={run.id} runId={run.id} token={accessToken} onSaved={() => void load()} />
        {board.fuzzy.length ? <details className="yt-details"><summary>받아쓰기와 비슷한 구간으로만 찾은 문구 {board.fuzzy.length}개</summary>
          <ul className="yt-list">{board.fuzzy.map((f) => <li key={f}>{f}</li>)}</ul></details> : null}
        {board.notes.length ? <details className="yt-details"><summary>AI가 남긴 제안 {board.notes.length}개</summary>
          <ul className="yt-list">{board.notes.map((n) => <li key={n}>{n}</li>)}</ul></details> : null}
        {/* Every stage the server takes a 수정 요청 in, the preview clips included (로건 피드백 A-7: the button was gone at 시안 확인). */}
        {["storyboard_review", "storyboard_confirmed", "cta_pending", "prep_pending", "prep_ready", "clips_pending", "clips_review"].includes(run.stage) ? <div className="yt-note">
          <strong>{run.stage === "storyboard_review" ? "로건, 유쓰 확인" : "기획표 다시 고치기"}</strong>
          {run.stage === "storyboard_review" ? <p>{short ? "확인 완료를 누르면 숏폼 미리보기가 바로 시작돼요." : "확인 완료를 누르면 3단계 미리보기가 바로 시작됩니다. 기획표의 사진 · 도식 · 글자 · 음악으로 미리보기 영상을 만들고, 구독 대사 음성(유료)과 사운드 편집은 미리보기 확인 뒤 4단계에서 합니다."}</p> : null}
          <label>메모 (수정 요청할 때는 필수)<textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder={short ? "예) 3번 장면은 큰 글자로, 도식 칸 글자를 줄여서" : "예) 7번 비유는 빼고, 구독은 두 번째 섹션 끝으로"} /></label>
          {run.stage === "storyboard_review" && !short ? <DraftPlacePicker value={place} onChange={setPlace} status={localPc} ready={run.localReady} token={accessToken} onConnected={() => void reloadLocal()} /> : null}
          <div className="yt-actions">
            {run.stage === "storyboard_review" ? <button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => void act("confirm", () => post("/myin", "PATCH", { action: "review", runId: run.id, decision: "confirmed", note, place }))}>{busy === "confirm" ? "저장 중…" : "기획표 확인 완료 · 미리보기 만들기"}</button> : null}
            <button type="button" className="secondary-button" disabled={Boolean(busy) || !note.trim()} onClick={() => void act("revise", () => post("/myin", "PATCH", { action: "review", runId: run.id, decision: "revise", note }))}>수정 요청</button>
          </div>
          {run.review?.decision === "confirmed" ? <small>{run.review.name} 확인 · {when(run.review.at)}{run.review.note ? ` · ${run.review.note}` : ""}</small> : null}
        </div> : null}
      </> : null}
    </Step>

    <Step index={2} state={step3} title={short ? "미리보기 확인 (로건, 유쓰)" : "미리보기 확인 (도식 · 글자 · 음악 — 로건, 유쓰)"} idBase="myin-step">
      {short ? <p>기획표 확인이 끝나면 자동으로 시작해요. 숏폼 전체를 세로 미리보기로 만들어요. 고칠 곳이 있으면 [수정 요청]을 눌러요.</p> : <p>기획표 확인이 끝나면 자동으로 시작합니다. 고른 곳(영상 만드는 컴퓨터 또는 내 컴퓨터)이 기획표의 사진을 받아 넣고(받지 못한 사진만 회색 「사진 자리」), 로건님 자동 선곡으로 장면마다 곡을 깔고, 문구 위치를 점검한 뒤 오프닝·쇼릴과 비유 장면을 720p 미리보기 영상으로 먼저 만듭니다. 고칠 곳이 있으면 [수정 요청]을 눌러요. 기획표가 메모와 함께 내 AI에게 다시 가요.</p>}
      {run && !materials && ["prep_pending", "clips_pending"].includes(run.stage) ? <div className="yt-run"><div className="yt-run-head"><RunState run={run} /></div>
        {draftWaiting ? <div className="yt-actions"><small>만드는 곳 · {maker(run)}</small>
          {run.local ? <button type="button" className="secondary-button compact" disabled={Boolean(busy) || (Boolean(run.workingSince) && localPc?.state === "online")}
            onClick={() => void act("place", () => post("/myin", "PATCH", { action: "place", runId: run.id, place: "pc" }))}>영상 만드는 컴퓨터로 보내기</button>
            : !localBlocker(localPc, run.localReady) && !run.workingSince ? <button type="button" className="secondary-button compact" disabled={Boolean(busy)}
              onClick={() => void act("place", () => post("/myin", "PATCH", { action: "place", runId: run.id, place: "local" }))}>내 컴퓨터로 만들기</button> : null}
        </div> : null}</div> : null}
      {run?.prepared && !materials ? <div className="yt-run">
        <div className="yt-run-head"><span className="status-pill" data-status={run.prepared.misses.length ? "failed" : "approved"}>문구 못 찾음 {run.prepared.misses.length}개</span><small>{when(run.prepared.at)}</small></div>
        {run.prepared.misses.length ? <ul className="yt-list">{run.prepared.misses.map((m) => <li key={m}>{m}</li>)}</ul> : null}
      </div> : null}
      {/* ③ and ④ both prepare new sheets; the screen check reads each set, the last chance being before the full video. */}
      {run?.prepared ? <MyinScreenCheck runId={run.id} preparedAt={run.prepared.at} token={accessToken} onScene={(sheet) => void showSheet(sheet)} /> : null}
      {run?.prepared ? <details className="yt-details" open={sheetsOpen} onToggle={(event) => { const open = (event.target as HTMLDetailsElement).open; setSheetsOpen(open); if (open && !sheets.length) void showSheets(); }}>
        <summary>점검 시트 {run.prepared.sheets}장 보기</summary>
        <p className="yt-note">장면마다 한 컷씩입니다. 쇼릴 뒤부터는 컷 시각이 조금 앞당겨져 보이니(로건님 점검 기능의 특성), 문구 확인은 위 개수로 합니다.</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URLs from private storage */}
        {sheets.map((url, index) => <img key={url} id={`yt-sheet-${index + 1}`} src={url} alt={`미리보기 점검 시트 ${index + 1}`} style={{ width: "100%", borderRadius: 8 }} />)}
      </details> : null}
      {run?.sound?.report ? <details className="yt-details"><summary>자동 선곡표 (로건님 음악 매칭)</summary>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 360, overflow: "auto", margin: 0 }}>{run.sound.report}</pre></details> : null}
      {outputs?.clips.length ? <div style={{ display: "grid", gap: 12 }}>{outputs.clips.map((clip) => <div key={clip.label} style={{ display: "grid", gap: 4 }}>
        <small>{clip.label}</small>{clip.url ? <video src={clip.url} controls preload="metadata" style={short ? { width: "100%", maxWidth: 360, aspectRatio: "9 / 16", borderRadius: 8, background: "#000" } : { width: "100%", borderRadius: 8, background: "#000" }} /> : null}</div>)}</div> : null}
      {run?.stage === "clips_review" && !materials ? <div className="yt-note">
        <strong>로건, 유쓰 확인</strong>
        <label>메모 (수정 요청할 때는 필수)<textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="예) 오프닝 좋음 · 7번 빙산 장면 글자가 넘쳐요" /></label>
        {/* 시안 확인 = 사진 허락: the photos and the 구독 대사 voice (paid) start at once, so ask once and offer 수정 요청 beside it. */}
        <div className="yt-actions"><button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => void (async () => {
          if (!window.confirm(short ? "이 미리보기로 확정하고 숏폼 전체 영상을 만들어요. 시작할까요?" : "이 미리보기로 확정하고 4단계 자료 준비를 시작해요. 미리보기의 사진을 확정하고 구독 대사 음성을 만들어요. 시작할까요?")) return;
          if (board && !await askVoice(board.cta.map((c) => c.line).join("\n"), "이미 만든 문장은 다시 들지 않아요", Boolean(run.voiceOnPc))) return;
          await act("clips", () => post("/myin", "PATCH", { action: "clips_ok", runId: run.id, note }));
        })()}>{busy === "clips" ? "저장 중…" : short ? "미리보기 확인 완료 · 전체 영상 만들기" : "미리보기 확인 완료 · 자료 준비 시작"}</button>
          {board?.cta.length ? <CostTag kind="paid" /> : null}
          <button type="button" className="secondary-button" disabled={Boolean(busy) || !note.trim()} onClick={() => void act("revise", () => post("/myin", "PATCH", { action: "review", runId: run.id, decision: "revise", note }))}>수정 요청</button></div>
      </div> : null}
      {run?.clipsReview ? <small>{run.clipsReview.name} 미리보기 확인 · {when(run.clipsReview.at)}{run.clipsReview.note ? ` · ${run.clipsReview.note}` : ""}</small> : null}
      {run && !materials && (run.stage === "prep_ready" || (run.status === "blocked" && ["prep_pending", "clips_pending"].includes(run.stage))) ? <div className="yt-actions">
        <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void act("prep", () => post("/myin", "PATCH", { action: "prepare", runId: run.id }))}>{busy === "prep" ? "시작하는 중…" : "미리보기 다시 준비하기"}</button>
        <small>문구 점검과 미리보기를 다시 만듭니다.</small></div> : null}
    </Step>

    <Step index={3} state={step4} title={short ? "사진 확정" : "자료 준비 (사진 · 구독 대사 · 사운드)"} idBase="myin-step">
      <p>{short ? "미리보기를 확인하면 사진을 확정하고 바로 전체 영상을 만들어요. 숏폼은 음악 없이 목소리만 들어가요." : "미리보기 확인을 누르면 자동으로 시작합니다. 미리보기의 사진을 확정하고 구독 대사 음성을 만든 뒤 영상 만드는 컴퓨터가 다시 점검합니다. 끝나면 아래에서 음악 · 앰비언스 · 효과음을 확인하고 고친 뒤 [전체 영상 만들기]를 누릅니다."}</p>
      {materials && assetsUsed.length ? <ul className="yt-list">{assetsUsed.map((a) =>
        <li key={a.file}>{KIND[a.kind] ?? a.kind} · {a.file} · {a.source} <a href={a.url} target="_blank" rel="noreferrer">출처</a></li>)}</ul> : null}
      {run && materials && ["cta_pending", "prep_pending"].includes(run.stage) ? <div className="yt-run"><div className="yt-run-head">
        <RunState run={run} />
        {run.ctaReady ? <small>구독 대사 {run.ctaReady}</small> : null}</div></div> : null}
      {run?.prepared && materials && run.stage === "prep_ready" ? <div className="yt-run">
        <div className="yt-run-head"><span className="status-pill" data-status={run.prepared.misses.length ? "failed" : "approved"}>{run.prepared.misses.length ? `문구 못 찾음 ${run.prepared.misses.length}개` : "사진 · 구독 대사 준비 완료"}</span><small>{when(run.prepared.at)}</small></div>
        {run.prepared.misses.length ? <ul className="yt-list">{run.prepared.misses.map((m) => <li key={m}>{m}</li>)}</ul> : null}
      </div> : null}
      {run && materials && run.stage === "prep_ready" && !run.prepared?.misses.length ? <>
        {short ? null : run.sound ? <MyinSoundEditor runId={run.id} token={accessToken} editable={!busy} onSaved={load} />
          : <p className="yt-note">이 영상은 사운드 창고 전 패키지로 시작해 음악은 기획표대로 들어가요. 새로 시작하는 영상부터 여기서 고칠 수 있어요.</p>}
        {run.sound?.edited ? <small>{run.sound.edited.name} 사운드 수정 · {when(run.sound.edited.at)}</small> : null}
        {run.voiceChanged ? <p className="yt-note yt-warn">최종 검토 피드백 {run.voiceChanged.count}곳의 음성을 다시 만들었어요 · {when(run.voiceChanged.at)}. 전체 영상을 다시 만들어야 새 음성이 들어가요.</p> : null}
        <div className="yt-run"><div className="yt-run-head">
          <span><strong>다 확인했으면 전체 영상을 만들어요</strong><br /><small>영상 만드는 컴퓨터에서 {finalMinutes(run)}분쯤 걸려요 · 저장하지 않은 사운드 변경은 들어가지 않아요</small></span>
          <button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => {
            if (!window.confirm(`지금 사진과 사운드로 1080p 60fps 전체 영상을 만들어요. 영상 만드는 컴퓨터에서 ${finalMinutes(run)}분쯤 걸려요. 저장하지 않은 사운드 변경은 들어가지 않아요. 만들까요?`)) return;
            void act("final", () => post("/myin", "PATCH", { action: "final", runId: run.id }));
          }}>{busy === "final" ? "시작하는 중…" : "전체 영상 만들기"}</button></div></div>
      </> : null}
      {run?.prepared && materials ? <details className="yt-details"><summary>출처 목록 {run.prepared.credits.length}개 (⑥ 발행 설명란용)</summary>
        <ul className="yt-list">{run.prepared.credits.map((c) => <li key={c}>{c}</li>)}</ul></details> : null}
      {run && materials && ((run.stage === "prep_ready" && run.prepared?.misses.length) || (run.status === "blocked" && ["cta_pending", "prep_pending"].includes(run.stage))) ? <div className="yt-actions">
        <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void act("prep", () => post("/myin", "PATCH", { action: "prepare", runId: run.id }))}>{busy === "prep" ? "시작하는 중…" : "자료 준비 다시 하기"}</button>
        <small>사진을 다시 받고 점검을 다시 돌립니다. 같은 구독 대사면 음성은 그대로 씁니다.</small></div> : null}
    </Step>

    <Step index={4} state={step5} title={short ? "완성 영상" : "완성 영상과 자료 확인"} idBase="myin-step">
      <p>{short ? "세로 1080×1920 숏폼과 유튜브 자막 파일을 영상 만드는 컴퓨터가 만들어 올려요." : "1080p 전체 영상, 음향 마스터링, 한 장 정리 이미지와 덱 PDF, 유튜브 자막 파일을 영상 만드는 컴퓨터가 만들어 올립니다. 소리가 아쉬우면 [4단계로 돌아가 사운드 고치기]를 눌러요. 기획표와 미리보기는 그대로 두고 전체 영상만 다시 만듭니다."}</p>
      {run?.stage === "final_pending" ? <div className="yt-run"><div className="yt-run-head">
        <RunState run={run} /></div>
        {run.status === "blocked" ? <div className="yt-actions"><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void act("final", () => post("/myin", "PATCH", { action: "final", runId: run.id }))}>{busy === "final" ? "시작하는 중…" : "전체 영상 다시 만들기"}</button></div> : null}</div> : null}
      {run?.final ? <div className="yt-run"><div className="yt-run-head">
        <span className="status-pill" data-status={Math.abs(run.final.lufs + 14) <= 1 && run.final.peak <= -1 ? "approved" : "review"}>완성 · {short ? `${Math.round(run.final.durationSeconds)}초` : `${Math.floor(run.final.durationSeconds / 60)}분 ${Math.round(run.final.durationSeconds % 60)}초`}</span>
        <small>{(run.final.bytes / 1e6).toFixed(1)}MB · 음량 {run.final.lufs} LUFS · 최대 {run.final.peak} dB · {when(run.final.at)}</small></div></div> : null}
      {outputs?.video ? <video src={outputs.video} controls preload="metadata" style={short ? { width: "100%", maxWidth: 360, aspectRatio: "9 / 16", borderRadius: 8, background: "#000" } : { width: "100%", borderRadius: 8, background: "#000" }} /> : null}
      {run?.final && outputs ? <ul className="yt-list">
        {outputs.summary ? <li><a href={outputs.summary} target="_blank" rel="noreferrer">한 장 정리 이미지 (PNG)</a></li> : null}
        {outputs.deck ? <li><a href={outputs.deck} target="_blank" rel="noreferrer">덱 전체 (PDF) — 설명란·고정 댓글용</a></li> : null}
        {outputs.srt ? <li><a href={outputs.srt} target="_blank" rel="noreferrer">유튜브 자막 파일 (SRT)</a></li> : null}
      </ul> : null}
      {run?.stage === "final_ready" && run.clipsReview && !short ? <div className="yt-actions">
        <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void act("reopen", () => post("/myin", "PATCH", { action: "reopen", runId: run.id }))}>{busy === "reopen" ? "여는 중…" : "4단계로 돌아가 사운드 고치기"}</button>
        <small>고친 뒤 [전체 영상 만들기]를 누르면 새 완성본이 다음 버전으로 올라와요.</small></div> : null}
      {run?.final ? finalNote ?? <p className="yt-note">이어폰으로 소리를 확인한 뒤 <a href={`/content/production?sourceId=${sourceId}`}>제작 현황 › 제작 자산·전체 승인 현황</a>에서 대표가 최종 영상·업로드 자료를 승인하고, <a href={`/content/publishing?sourceId=${sourceId}`}>⑥ 발행·업로드</a>에서 [OS 완성본 쓰기]로 올립니다. 업로드 자료는 ⑦ 유튜브 관리에서 만듭니다. 자막 파일과 엔드 스크린은 유튜브 스튜디오에서 사람이 합니다.</p> : null}
    </Step>
    {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
  </div>;
}
