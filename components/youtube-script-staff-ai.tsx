"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest, ApiRequestError } from "@/lib/api-client";
import type { ScriptReviewState } from "@/lib/content-script-review";
import type { WritingWorkflowState } from "@/lib/content-writing-workflow";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";
import { StaffDesign, type StaffJobStatus } from "./youtube-production-steps";

interface PipelineState { source: OsRecord; records: OsRecord[]; writing: WritingWorkflowState; scriptReview: ScriptReviewState }
interface Submission { canonBundle?: string; reReviews?: number; suggestions?: string[]; osCheck?: { chars: number; paragraphs: number; sections: number } }
const EMPTY = { manuscript: "", materials: "", axis: "", design: "", review: "", canonBundle: "" };

/**
 * ② 원고 by the staff member's own AI (원고 공정 정본 v1.0): send the job, see where it stands, read what came back and confirm
 * once — the eight per-step approvals below stay for hand work. Hidden where the DEV pilot is closed.
 */
export function YoutubeScriptStaffAi({ sourceId, state, onChange }: { sourceId: string; state: PipelineState | null; onChange: () => Promise<void> }) {
  const { accessToken } = useSession();
  const [status, setStatus] = useState<StaffJobStatus | null>(null);
  const [available, setAvailable] = useState(false);
  const [minutes, setMinutes] = useState(10);
  const [attachments, setAttachments] = useState("");
  const seenJob = useRef<string | null>(null);
  const [paste, setPaste] = useState(EMPTY);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const next = await apiRequest<StaffJobStatus>(`/api/v1/content/youtube-automation/ai-jobs?sourceId=${encodeURIComponent(sourceId)}&task=script`, { token: accessToken });
      setStatus(next); setAvailable(true);
      // Show the length the latest job was sent with, once per job, without undoing an edit between polls.
      if (next.job && next.job.id !== seenJob.current) { seenJob.current = next.job.id; if (next.job.targetMinutes) setMinutes(next.job.targetMinutes); }
    }
    catch (reason) { if (reason instanceof ApiRequestError && reason.status === 404) setAvailable(false); }
  }, [accessToken, sourceId]);
  useEffect(() => { void load(); }, [load]);
  const open = Boolean(status?.job && ["backlog", "active"].includes(status.job.status));
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => { void load().then(onChange); }, 20_000);
    return () => window.clearInterval(timer);
  }, [open, load, onChange]);
  if (!available || !state) return null;

  const act = async (label: string, body: Record<string, unknown>, path = "/script") => {
    setBusy(label); setError("");
    try { await apiRequest(`/api/v1/content/youtube-automation${path}`, { method: "POST", token: accessToken, body: JSON.stringify({ sourceId, ...body }) }); await load(); await onChange(); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : "처리하지 못했습니다."); return false; }
    finally { setBusy(""); }
  };
  const { writing, scriptReview, source } = state;
  const ready = writing.packageReady && !writing.steps[0]?.blocker;
  const script = state.records.filter((record) => record.record_type === "content_script" && !record.archived_at).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const byStaff = script && ["staff_ai", "staff"].includes(String(script.metadata.generatedBy));
  const submission = (script?.metadata.submission ?? {}) as Submission;
  const confirmed = writing.ready && scriptReview.ready;

  return <section className="panel writing-workflow" aria-label="내 AI로 원고 쓰기">
    <header className="panel-header"><div><span className="eyebrow">원고 공정 정본대로</span><h2>내 AI로 원고 쓰기</h2>
      <p>내 AI(Claude 또는 Codex)가 정본·기획·자료를 직접 읽고 축 → 설계 → 초안 → 검수를 돌려 원고를 제출합니다. OS가 형식을 세고, 담당 직원이 읽고 한 번 확인하면 대표 최종 승인으로 넘어갑니다.</p></div></header>
    {!ready ? <p className="yt-note">{writing.steps[0]?.blocker || "기획 승인과 제목·썸네일 채택이 먼저 필요합니다."}</p> : (() => {
      const send = <>
        <label className="yt-actions">목표 길이 <input type="number" min={1} max={60} value={minutes} onChange={(event) => setMinutes(Number(event.target.value) || 10)} style={{ width: 72 }} /> 분 (공백 포함 약 {minutes * 600}자)</label>
        <label>카드에 붙일 자료 (선택)<textarea rows={3} value={attachments} onChange={(event) => setAttachments(event.target.value)} placeholder="같은 고민을 다룬 영상 댓글 원문(좋아요 수 포함 6개 이상), 직접 고른 재료나 문서 이름 등" /></label>
        <StaffDesign status={status} busy={busy === "send"} onSend={() => void act("send", { task: "script", targetMinutes: minutes, ...(attachments.trim() ? { attachments: attachments.trim() } : {}) }, "/ai-jobs")} />
      </>;
      // Once a staff script exists, a new job replaces it, so sending again sits behind one more click.
      return byStaff && !open ? <details className="yt-details"><summary>새 원고로 다시 쓰기</summary>{send}</details> : send;
    })()}
    {byStaff ? <div className="yt-run">
      <div className="yt-run-head"><span className="status-pill" data-status={confirmed ? "approved" : "review"}>{confirmed ? "직원 확인 완료" : "직원 확인 필요"}</span>
        <small>{script.metadata.generatedBy === "staff_ai" ? `직원 AI · ${String(script.metadata.model ?? "")}` : "직원 직접 입력"}{submission.canonBundle ? ` · 정본 묶음 ${submission.canonBundle}` : ""}{submission.reReviews ? ` · 재검수 ${submission.reReviews}회` : ""}</small></div>
      {submission.osCheck ? <small>OS 형식 검사(관문 1) 통과 · {submission.osCheck.chars.toLocaleString()}자 · 문단 {submission.osCheck.paragraphs}개 · 섹션 {submission.osCheck.sections}개</small> : null}
      {submission.suggestions?.length ? <details className="yt-details"><summary>정본 개선 제안 {submission.suggestions.length}개</summary><ul className="yt-list">{submission.suggestions.map((item) => <li key={item}>{item}</li>)}</ul></details> : null}
      {confirmed ? <p className="yt-note">다음: 대표 최종 승인 · <Link href={`/content/production?sourceId=${sourceId}`}>제작 허브에서 승인 요청 보기</Link></p>
        : <div className="yt-actions"><button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => void act("confirm", { action: "confirm", expectedVersion: source.version })}>{busy === "confirm" ? "확인 중…" : "읽고 확인했어요 (한 번에 확인)"}</button>
          <small>아래 원고·자료·축·설계·검수 기록을 읽은 뒤 누릅니다. 원고를 고쳤으면 고친 문단은 관문 1·6을 다시 거칩니다.</small></div>}
    </div> : null}
    {ready ? <details className="yt-details"><summary>내 AI와 대화로 직접 쓴 원고 붙여 넣기</summary>
      <form onSubmit={(event) => { event.preventDefault(); void act("paste", { action: "submit", expectedVersion: source.version, targetMinutes: minutes, bundle: paste }).then((ok) => { if (ok) setPaste(EMPTY); }); }}>
        {([["manuscript", "원고 (§8 형식: # 제목, 머리 블록, ## 섹션, 문단)", 12], ["materials", "자료 표 (찾아본 곳 · 쓴 재료와 출처 · 뺀 후보)", 4], ["axis", "축 (채택 축 · 축 채점 · 중심 인물)", 4], ["design", "설계표", 6], ["review", "검수 기록 (관문별 결과 · 틀렸을 만한 것 3개 · 재검수 이력)", 5]] as const).map(([key, label, rows]) =>
          <label key={key}>{label}<textarea rows={rows} value={paste[key]} onChange={(event) => setPaste((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
        <label>정본 묶음 값 (선택)<input value={paste.canonBundle} onChange={(event) => setPaste((current) => ({ ...current, canonBundle: event.target.value }))} placeholder="예) v1.0 (2026-10-18)" /></label>
        <div className="yt-actions"><button type="submit" className="secondary-button" disabled={Boolean(busy) || !paste.manuscript.trim() || !paste.materials.trim() || !paste.axis.trim() || !paste.design.trim() || !paste.review.trim()}>{busy === "paste" ? "넣는 중…" : "원고 넣기"}</button>
          <small>내 AI 제출과 같은 형식 검사를 거쳐 같은 자리에 들어갑니다.</small></div>
      </form>
    </details> : null}
    {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
  </section>;
}
