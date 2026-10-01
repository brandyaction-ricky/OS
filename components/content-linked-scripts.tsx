"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiRequest, generateContent, updateRecord } from "@/lib/api-client";
import type { WritingPreparationStep, WritingWorkflowState, WritingWorkflowStep } from "@/lib/content-writing-workflow";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";
import { ContentPlanningHandoff } from "./content-planning-handoff";

interface LinkedPipelineState { source: OsRecord; records: OsRecord[]; writing: WritingWorkflowState }
const PREPARATION_PLACEHOLDERS: Record<WritingPreparationStep, string> = {
  materials: "확인한 출처, 핵심 사실, 직접 경험과 아직 확인하지 못한 한계를 함께 적어주세요.",
  axis: "이 영상이 끝난 뒤 시청자가 얻어야 할 한 문장과, 포함할 것·뺄 것을 정해주세요.",
  design: "도입 훅 → 문제 풀이 → 근거·사례 → 해석 → 마무리 순서와 칠판·화면 표현을 적어주세요.",
};

export function ContentLinkedScripts({ showPlanningHandoff = false }: { showPlanningHandoff?: boolean }) {
  const { accessToken } = useSession();
  const [sourceId, setSourceId] = useState("");
  const [state, setState] = useState<LinkedPipelineState | null>(null);
  const [scripts, setScripts] = useState<OsRecord[]>([]);
  const [draft, setDraft] = useState("");
  const [preparation, setPreparation] = useState<Record<WritingPreparationStep, string>>({ materials: "", axis: "", design: "" });
  const [reviewNotes, setReviewNotes] = useState<Partial<Record<WritingWorkflowStep, string>>>({});
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { setSourceId(new URLSearchParams(window.location.search).get("sourceId") ?? ""); }, []);

  const load = useCallback(async () => {
    if (!sourceId || !accessToken) return;
    const loaded = await apiRequest<LinkedPipelineState>(`/api/v1/content/pipeline?sourceId=${encodeURIComponent(sourceId)}`, { token: accessToken });
    if (loaded.source.id !== sourceId || loaded.source.record_type !== "content_topic") throw new Error("연결된 기획 주제를 확인할 수 없습니다.");
    const linked = loaded.records.filter((record) => record.record_type === "content_script").sort((a, b) => b.created_at.localeCompare(a.created_at));
    const stepContent = Object.fromEntries(loaded.writing.steps.filter((step) => step.key !== "package").map((step) => [step.key, step.content])) as Record<WritingPreparationStep, string>;
    setState(loaded); setScripts(linked); setDraft(linked[0]?.description ?? ""); setPreparation(stepContent); setError("");
  }, [accessToken, sourceId]);

  useEffect(() => {
    if (!sourceId || !accessToken) return;
    let active = true;
    load().catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "연결된 원고 공정을 불러오지 못했습니다."); });
    return () => { active = false; };
  }, [accessToken, load, sourceId]);

  const perform = async (action: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await action(); await load(); setNotice(success); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "작업을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  const savePreparation = (step: WritingPreparationStep) => {
    if (!state) return;
    const label = state.writing.steps.find((item) => item.key === step)?.label ?? "준비";
    void perform(() => apiRequest("/api/v1/content/pipeline", { method: "POST", token: accessToken, body: JSON.stringify({ operation: "writing_save", sourceId, expectedVersion: state.source.version, step, content: preparation[step] }) }), `${label} 내용을 저장했습니다. 저장만으로는 승인되지 않습니다.`);
  };
  const reviewPreparation = (step: WritingWorkflowStep, approved: boolean) => {
    if (!state) return;
    void perform(() => apiRequest("/api/v1/content/pipeline", { method: "POST", token: accessToken, body: JSON.stringify({ operation: "writing_review", sourceId, expectedVersion: state.source.version, step, approved, note: reviewNotes[step] ?? "" }) }), approved ? "현재 내용을 승인했습니다. 다음 단계가 열렸습니다." : "수정 요청을 저장했습니다.");
  };
  const generateScript = () => {
    if (!state) return;
    void perform(async () => { const response = await generateContent(accessToken, { action: "script_draft", sourceId }); if (response.queued) throw new Error("Claude 연결이 필요합니다. 준비한 자료와 승인 이력은 저장되어 있습니다."); }, "승인된 자료·축·설계로 원고 초안을 만들었습니다.");
  };
  const script = scripts[0];
  const saveScript = async () => {
    if (!script || busy) return;
    await perform(async () => { const { record } = await updateRecord(accessToken, { id: script.id, expectedVersion: script.version, description: draft, status: "review" }); setScripts((current) => [record, ...current.filter((item) => item.id !== record.id)]); }, "원고를 저장했습니다. 변경된 원고는 공정 화면에서 다시 승인해야 합니다.");
  };
  if (!sourceId) return null;
  const source = state?.source ?? null; const writing = state?.writing ?? null;
  return <>
    {showPlanningHandoff && source ? <ContentPlanningHandoff key={`${source.id}:${source.version}`} source={source} /> : null}
    {writing ? <section className="panel writing-workflow" aria-label="자료와 원고 전 작업">
      <header className="panel-header"><div><span className="eyebrow">같은 콘텐츠 기록에서 이어서 작업</span><h2>자료 → 핵심 축 → 영상 설계 → 원고</h2><p>각 단계를 저장한 뒤 사람이 승인해야 다음 단계가 열립니다. 상위 패키징이 바뀌면 기존 내용은 남고 승인만 다시 필요합니다.</p></div><Link className="secondary-button" href={`/content/packages?sourceId=${sourceId}`}>패키징 확인</Link></header>
      <dl className="writing-workflow-summary"><div><dt>현재 산출물</dt><dd>{writing.packageTitle || "채택한 제목 없음"}<small>{writing.packageCopy || "채택한 썸네일 카피 없음"}</small></dd></div><div><dt>다음 행동</dt><dd>{writing.nextAction}</dd></div><div><dt>막힌 이유</dt><dd>{writing.blocker || "없음"}</dd></div></dl>
      <div className="writing-workflow-steps">{writing.steps.map((step, index) => <article className={step.approved ? "approved" : ""} key={step.key}><header><span>{index + 1}</span><div><strong>{step.label}</strong><small>{step.approved ? "현재 버전 승인 완료" : step.lastReview && !step.lastReview.approved ? `수정 요청 · ${step.lastReview.note}` : step.blocker || "검토 가능"}</small></div><em>{step.approved ? "승인" : "준비"}</em></header>
        {step.key === "package" ? <div className="writing-package-choice"><strong>{writing.packageTitle || "제목 미채택"}</strong><span>{writing.packageCopy || "썸네일 카피 미채택"}</span><small>패키지 {writing.packageId ? `v${writing.packageVersion}` : "없음"}</small></div> : <textarea rows={step.key === "design" ? 7 : 5} value={preparation[step.key]} disabled={!step.canEdit || busy} placeholder={PREPARATION_PLACEHOLDERS[step.key]} onChange={(event) => setPreparation((current) => ({ ...current, [step.key]: event.target.value }))} />}
        <div className="writing-step-actions">{step.key !== "package" ? <button className="secondary-button" disabled={!step.canEdit || busy || !preparation[step.key].trim()} onClick={() => savePreparation(step.key as WritingPreparationStep)}>내용 저장</button> : null}<button className="primary-button" disabled={busy || step.approved || !step.canApprove} title={step.blocker} onClick={() => reviewPreparation(step.key, true)}>현재 내용 승인</button></div>
        {(step.content || step.key === "package") ? <div className="writing-revision"><input aria-label={`${step.label} 수정 요청 사유`} value={reviewNotes[step.key] ?? ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [step.key]: event.target.value }))} placeholder="수정 요청 사유" /><button className="ghost-button" disabled={busy || !(reviewNotes[step.key] ?? "").trim()} onClick={() => reviewPreparation(step.key, false)}>수정 요청</button></div> : null}
      </article>)}</div>
      <footer><span>{writing.ready ? "원고 전 작업이 모두 승인됐습니다." : `다음: ${writing.nextAction}`}</span><button className="primary-button" disabled={busy || !writing.ready} title={writing.blocker || "승인된 현재 산출물로 원고를 만듭니다."} onClick={generateScript}>{busy ? "처리 중…" : "원고 초안 만들기"}</button></footer>
    </section> : <section className="panel pipeline-panel"><p>{error || "연결된 작업 공정을 불러오는 중…"}</p></section>}
    {notice ? <p className="inline-alert">{notice}</p> : null}{error ? <p className="inline-alert danger">{error}</p> : null}
    <section className="panel pipeline-panel"><header><h2>연결된 제작 공정 원고</h2><Link href={`/content/automation?sourceId=${sourceId}`}>공정·승인 현황으로</Link></header>{script ? <><strong>{script.title} · v{script.version}</strong><p>원고를 수정하면 공정 화면에서 해당 자료를 다시 승인해야 합니다.</p><textarea rows={18} aria-label="연결된 원고 본문" value={draft} onChange={(event) => setDraft(event.target.value)} /><button className="primary-button" disabled={busy || !draft.trim()} onClick={saveScript}>원고 저장</button></> : <p>연결된 원고가 없습니다. 패키징·자료·축·설계를 순서대로 승인하면 이 화면에서 초안을 만들 수 있습니다.</p>}</section>
  </>;
}
