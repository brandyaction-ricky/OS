"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiRequest, generateContent, updateRecord } from "@/lib/api-client";
import { PIPELINE_GATES, pipelineArtifacts, type PipelineAction, type PipelineReview, type PipelineRun } from "@/lib/content-pipeline";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";

interface PipelineState { source: OsRecord; records: OsRecord[]; reviews: PipelineReview[]; signatures: string[]; approved: boolean[]; missing: string[][] }
const ACTIONS: Array<{ action: PipelineAction; label: string; gate: number }> = [
  { action: "topic_plan", label: "기획 브리핑 생성", gate: 0 }, { action: "script_draft", label: "원고 생성", gate: 1 },
  { action: "title_package", label: "제목·썸네일 생성", gate: 1 }, { action: "shorts_proposal", label: "숏폼 구간 제안", gate: 2 }, { action: "youtube_kit", label: "발행키트 생성", gate: 2 },
];

export function ContentPipelinePanel({ sourceId, onChange }: { sourceId: string; onChange: () => Promise<void> }) {
  const { accessToken } = useSession();
  const [state, setState] = useState<PipelineState | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [notes, setNotes] = useState<Record<number, string>>({});
  const load = useCallback(async () => {
    const data = await apiRequest<PipelineState>(`/api/v1/content/pipeline?sourceId=${encodeURIComponent(sourceId)}`, { token: accessToken }); setState(data);
  }, [accessToken, sourceId]);
  useEffect(() => { setState(null); load().catch((reason) => setError(String(reason.message))); }, [load]);
  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await action(); await load(); await onChange(); } catch (reason) { setError(reason instanceof Error ? reason.message : "공정을 처리하지 못했습니다."); await load().catch(() => {}); }
    finally { setBusy(false); }
  };
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!state) return;
    const form = new FormData(event.currentTarget);
    void perform(() => updateRecord(accessToken, { id: sourceId, expectedVersion: state.source.version, metadata: { ...state.source.metadata, pipelineEnabled: true,
      audience: String(form.get("audience") ?? "").trim(), evidence: String(form.get("evidence") ?? "").trim(), experience: String(form.get("experience") ?? "").trim(), finalVideoUrl: String(form.get("finalVideoUrl") ?? "").trim() } }));
  };
  if (!state || state.source.id !== sourceId) return <section className="panel pipeline-panel"><p>{error || "공정 불러오는 중…"}</p></section>;
  const artifacts = pipelineArtifacts(state.records);
  const enabled = state.source.metadata.pipelineEnabled === true;
  const runs = (Array.isArray(state.source.metadata.pipelineRuns) ? state.source.metadata.pipelineRuns : []) as PipelineRun[];
  return <section className="panel pipeline-panel">
    <header><h2>숏폼 제작 공정</h2><p>자료와 산출물을 확인하고 각 단계에서 승인합니다. 변경된 자료는 다시 검토해야 합니다.</p><button className="ghost-button" disabled={busy} onClick={() => void perform(load)}>새로 불러오기</button></header>
    {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
    <form key={sourceId} onSubmit={save} className="pipeline-inputs">
      <label>타깃 시청자<input required name="audience" defaultValue={String(state.source.metadata.audience ?? "")} /></label>
      <label>확인한 자료·출처<textarea required name="evidence" rows={4} defaultValue={String(state.source.metadata.evidence ?? "")} placeholder="자료 링크와 직접 확인한 사실을 적어주세요." /></label>
      <label>실제 경험·사례<textarea required name="experience" rows={3} defaultValue={String(state.source.metadata.experience ?? "")} placeholder="제공할 사례 또는 해당 없는 사유" /></label>
      <label>최종 영상 URL<input type="url" pattern="https://.*" name="finalVideoUrl" defaultValue={String(state.source.metadata.finalVideoUrl ?? "")} placeholder="편집 완료 후 검토할 영상 주소" /></label>
      <button className="primary-button" disabled={busy}>{enabled ? "입력 자료 저장" : "자료 저장·공정 시작"}</button>
    </form>
    <div className="pipeline-gates">{PIPELINE_GATES.map((title, index) => {
      const gate = index + 1; const prior = state.reviews.filter((review) => review.gate === gate).at(-1);
      return <article key={title}><header><strong>{gate}. {title}</strong><span className={`status-pill status-${state.approved[index] ? "ready" : "review"}`}>{state.approved[index] ? "승인 완료" : prior?.signature !== undefined && prior.signature !== state.signatures[index] ? "자료 변경 · 재검토" : prior && !prior.approved ? "수정 요청" : "검토 대기"}</span></header>
        <div className="pipeline-actions">{ACTIONS.filter((item) => item.gate === index).map((item) => <button className="secondary-button" key={item.action} disabled={busy || !enabled || state.approved.slice(0, item.gate).some((approved) => !approved)} onClick={() => void perform(async () => { const result = await generateContent(accessToken, { sourceId, action: item.action, count: 5 }); if (result.queued) throw new Error("Claude 연결이 필요합니다. 입력 자료와 작업 이력은 저장되어 있습니다."); })}>{item.label}</button>)}</div>
        {state.missing[index].length ? <p>보완할 자료: {state.missing[index].join(" · ")}</p> : null}
        <label>검토 메모<textarea rows={2} value={notes[gate] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [gate]: event.target.value }))} /></label>
        <div className="pipeline-actions"><button className="primary-button" disabled={busy || !enabled || state.approved[index] || state.missing[index].length > 0 || state.approved.slice(0, index).some((value) => !value)} onClick={() => void perform(() => apiRequest("/api/v1/content/pipeline", { method: "POST", token: accessToken, body: JSON.stringify({ sourceId, gate, signature: state.signatures[index], approved: true, note: notes[gate] ?? "" }) }))}>검토한 자료 승인</button><button className="secondary-button" disabled={busy || !enabled || !notes[gate]?.trim()} onClick={() => void perform(() => apiRequest("/api/v1/content/pipeline", { method: "POST", token: accessToken, body: JSON.stringify({ sourceId, gate, signature: state.signatures[index], approved: false, note: notes[gate] }) }))}>수정 요청</button></div>
        {prior ? <small>{new Date(prior.at).toLocaleString("ko-KR")} · {prior.note || "검토 기록 저장됨"}</small> : null}
      </article>;
    })}</div>
    <div className="pipeline-artifacts">{[artifacts.research, artifacts.script, artifacts.packaging, artifacts.kit].filter((item): item is OsRecord => !!item).map((item) => <details key={item.id}><summary>{item.title} · v{item.version}</summary><pre>{item.record_type === "content_script" ? item.description : JSON.stringify(item.metadata.result ?? item.description, null, 2)}</pre></details>)}</div>
    <nav className="pipeline-actions"><Link href={`/content/scripts?sourceId=${sourceId}`}>원고</Link><Link href={`/content/shorts?sourceId=${sourceId}`}>자막·영상 편집</Link><Link href={`/content/youtube?sourceId=${sourceId}`}>유튜브 업로드</Link><Link href="/content/performance">영상 성과</Link></nav>
    <p>영상 렌더링과 외부 채널 발행은 연결 상태와 최종 결과를 별도로 확인합니다. 승인만으로 영상이 생성되거나 발행되지는 않습니다.</p>
    <details><summary>실행 이력 {runs.length}건 · 승인 이력 {state.reviews.length}건</summary>{runs.toReversed().map((run) => <p key={`${run.key}-${run.at}`}>{ACTIONS.find((item) => item.action === run.action)?.label ?? run.action} · {({ running: "실행 중", succeeded: "완료", failed: "실패", needs_input: "입력 필요" })[run.state]} · {new Date(run.at).toLocaleString("ko-KR")}{run.error ? ` · ${run.error}` : ""}</p>)}{state.reviews.toReversed().map((review, index) => <p key={`${review.at}-${index}`}>{PIPELINE_GATES[review.gate - 1]} · {review.approved ? "승인" : "수정 요청"} · {new Date(review.at).toLocaleString("ko-KR")} · {review.note}</p>)}</details>
  </section>;
}
