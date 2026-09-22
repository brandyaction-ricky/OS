"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";

type Score = { score: number; confidence: number };
type Result = {
  status: "ready";
  source: { id: string; version: number };
  shadowEvaluation: {
    contractVersion: string; mode: "shadow"; policyStatus: "pilot_noncanonical";
    executionAllowed: false; judgment: null; model: string; requestId: string;
    scores: { topicRelevance: Score; thumbnailClarity: Score; curiosityStrength: Score; evidenceBoundary: Score };
    overclaimRisk: { choice: "low" | "medium" | "high"; confidence: number; probabilities: { low: number; medium: number; high: number } };
    usage: { input_tokens: number; output_tokens: number }; evaluationTimeMs: number;
  };
};

const labels = [
  ["topicRelevance", "주제 관련성"], ["thumbnailClarity", "썸네일 명확성"],
  ["curiosityStrength", "궁금증"], ["evidenceBoundary", "근거 경계"],
] as const;
const riskLabels = { low: "낮음", medium: "보완 필요", high: "높음" } as const;

export function ContentJevShadowCheck({ sourceId, sourceVersion, token, disabled = false }: {
  sourceId: string; sourceVersion: number; token: string; disabled?: boolean;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    setResult(null); setMessage("");
    active.current?.abort(); active.current = null; setBusy(false);
    return () => { active.current?.abort(); };
  }, [sourceId, sourceVersion]);
  if (process.env.NEXT_PUBLIC_SYSTEM_ONE_JEV_SHADOW_ENABLED !== "true") return null;

  async function run() {
    if (busy || disabled) return;
    const controller = new AbortController(); active.current?.abort(); active.current = controller;
    setBusy(true); setMessage(""); setResult(null);
    try {
      const response = await apiRequest<Result>("/api/v1/system-one/jev-shadow", {
        method: "POST", token, signal: controller.signal,
        body: JSON.stringify({ id: sourceId, expectedVersion: sourceVersion }),
      });
      if (!controller.signal.aborted && response.source.id === sourceId && response.source.version === sourceVersion &&
        response.shadowEvaluation.mode === "shadow" && response.shadowEvaluation.executionAllowed === false &&
        response.shadowEvaluation.judgment === null) setResult(response);
      else if (!controller.signal.aborted) setMessage("시험 판정 계약을 확인하지 못했습니다. 결과를 적용하지 않습니다.");
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "JEV 시험 판정을 완료하지 못했습니다.");
    } finally {
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }

  const evaluation = result?.shadowEvaluation;
  return <section className="jev-shadow" aria-label="JEV 시험 판정">
    <header><div><span className="eyebrow">DEV/QA · Shadow</span><h4>JEV 시험 판정</h4>
      <p>저장된 기획 메모를 확률 점수로 비교합니다. 승인·저장·단계 이동에는 사용하지 않습니다.</p></div>
      <button className="secondary-button" disabled={busy || disabled} onClick={() => void run()}>{busy ? "판정 중…" : "JEV로 시험 판정"}</button></header>
    {evaluation ? <div role="status"><div className="jev-shadow-grid">{labels.map(([key, label]) => {
      const score = evaluation.scores[key];
      return <article key={key}><small>{label}</small><strong>{score.score.toFixed(2)}<i>/4</i></strong><span>확신도 {Math.round(score.confidence * 100)}%</span></article>;
    })}<article className={`risk-${evaluation.overclaimRisk.choice}`}><small>과장 위험</small><strong>{riskLabels[evaluation.overclaimRisk.choice]}</strong><span>높음 {Math.round(evaluation.overclaimRisk.probabilities.high * 100)}% · 보완 {Math.round(evaluation.overclaimRisk.probabilities.medium * 100)}%</span></article></div>
      <p className="content-workflow-note">{evaluation.model} · {Math.round(evaluation.evaluationTimeMs)}ms · 시험 계약 {evaluation.contractVersion}. 이 결과는 대표 판단이나 승인 기록이 아닙니다.</p></div> : null}
    {message ? <p className="inline-alert warning" role="status">{message}</p> : null}
  </section>;
}
