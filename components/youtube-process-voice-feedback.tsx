"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { feedbackClosed, voiceFeedback } from "@/lib/youtube-process/feedback";
import { stepHref } from "@/lib/youtube-process/project";
import { useCostConfirm, useCostModels, voiceEstimate } from "./cost-notice";
import type { YpFeedbackView, YpFinalView } from "./youtube-process-data";

interface VoiceRun { id: string; stage: string; voiceFixable?: boolean; voiceFixes?: { memo: string }[]; voiceChanged?: { at: string; count: number } | null }
const fmt = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/**
 * 최종 검토 음성 피드백 (로건 OS 요청 2026-10-30, phase ③): the open notes on this version that are about the voice, picked out by
 * their words; the ones ticked go to the render PC, which redoes only those sentences (the video time turned into the voice's), and
 * 제작 ④ then makes the full video again. Only a version the OS rendered from the video's current run can be mapped back to its voice.
 */
export function VoiceFeedbackBox({ projectId, final, items, token, onSeek }: {
  projectId: string; final: YpFinalView | undefined; items: YpFeedbackView[]; token: string | null; onSeek: (t: number) => void;
}) {
  const cost = useCostConfirm(), { myinVoice } = useCostModels();
  const [run, setRun] = useState<VoiceRun | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const runId = final?.source === "myin" ? final.runId : undefined;
  useEffect(() => {
    if (!runId) return;
    let live = true;
    apiRequest<{ run: VoiceRun | null }>(`/api/v1/content/youtube-automation/myin?sourceId=${encodeURIComponent(projectId)}`, { token })
      .then(result => { if (live) setRun(result.run?.id === runId ? result.run : null); }, () => undefined);
    return () => { live = false; };
  }, [projectId, runId, token]);
  if (!final || !runId || !run) return null;
  const voice = items.filter(item => item.target === "video" && item.ver === final.v && !feedbackClosed(item) && voiceFeedback(item.text));
  const pending = run.stage === "words_pending" && run.voiceFixes?.length;
  if (!pending && !run.voiceChanged && !voice.length) return null;
  const picked = voice.filter(item => !off.has(item.id));
  const at = (item: YpFeedbackView) => item.t ?? item.range?.[0] ?? 0;
  const send = async () => {
    const ok = await cost.confirm({ model: myinVoice, amount: voiceEstimate("가".repeat(picked.length * 120), myinVoice).krw,
      detail: `${picked.length}곳 · 문장마다 두 번 만들어 더 나은 것을 골라요`, ok: "확인하고 다시 만들기" });
    if (!ok) return;
    setBusy(true); setError("");
    try {
      const result = await apiRequest<{ run: VoiceRun }>("/api/v1/content/youtube-automation/myin", { method: "PATCH", token,
        body: JSON.stringify({ action: "voice_fix", runId: run.id, fixes: picked.map(item => ({ memo: `${fmt(at(item))} ${item.text}`.slice(0, 300), video: true })) }) });
      setRun(result.run);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "보내지 못했어요."); } finally { setBusy(false); }
  };
  return <div className="yp-note" role="status" style={{ display: "block", marginBottom: 10 }}>
    {cost.element}
    {pending ? <><b>음성 고치는 중 · {run.voiceFixes!.length}곳</b><br /><small>그 문장만 다시 만들어요. 끝나면 제작에서 전체 영상을 다시 만들어요.</small></>
      : run.voiceChanged ? <><b>음성을 다시 만들었어요 · {run.voiceChanged.count}곳</b><br />
        <Link className="yp-lnk" href={stepHref(3, projectId)}>제작에서 전체 영상 다시 만들기 →</Link></>
      : <><b>음성 피드백 {voice.length}개</b>
        {run.voiceFixable && ["final_ready", "prep_ready"].includes(run.stage) ? <>
          <ul style={{ listStyle: "none", padding: 0, margin: "6px 0", display: "grid", gap: 4 }}>{voice.map(item => <li key={item.id} style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
            <input type="checkbox" checked={!off.has(item.id)} aria-label={`${fmt(at(item))} 음성 다시 만들기`} onChange={event => setOff(set => { const next = new Set(set); if (event.target.checked) next.delete(item.id); else next.add(item.id); return next; })} />
            <button type="button" className="yp-lnk" onClick={() => onSeek(at(item))}>▷ {fmt(at(item))}</button><span>{item.text}</span></li>)}</ul>
          <button type="button" className="yp-btn yp-sm yp-pri" disabled={busy || !picked.length} onClick={() => void send()}>{busy ? "보내는 중…" : `고른 ${picked.length}곳 음성 다시 만들기`}</button>
        </> : <><br /><small>이 영상은 10/30 16시 전에 시작해 음성을 자동으로 고칠 수 없어요. 제작에서 음성을 다시 만들어요.</small></>}</>}
    {error ? <p className="yp-errline" role="alert">{error}</p> : null}
  </div>;
}
