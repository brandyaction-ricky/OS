"use client";

import { useEffect, useRef, useState } from "react";

type Score = { score: number; confidence: number };
type ScoreKey = "topicRelevance" | "thumbnailClarity" | "curiosityStrength" | "evidenceBoundary";
type Result = {
  status: "ready";
  source: { id: string; version: number };
  evaluationProtocolVersion: "jev-packaging-review-v3";
  inputChecks: { selectedPackage: true; planningHandoff: true; evidenceNotes: true; factualVerification: false };
  shadowEvaluation: {
    contractVersion: string; mode: "shadow"; policyStatus: "pilot_noncanonical";
    executionAllowed: false; judgment: null; model: string;
    scores: Record<ScoreKey, Score>;
    overclaimRisk: { choice: "low" | "medium" | "high"; confidence: number; probabilities: { low: number; medium: number; high: number } };
    usage: { input_tokens: number; output_tokens: number }; evaluationTimeMs: number;
  };
};

const labels = [
  ["topicRelevance", "주제 관련성"], ["thumbnailClarity", "썸네일 명확성"],
  ["curiosityStrength", "궁금증"], ["evidenceBoundary", "근거 경계"],
] as const satisfies ReadonlyArray<readonly [ScoreKey, string]>;
const riskLabels = { low: "낮음", medium: "보완 필요", high: "높음" } as const;
const stoppedMessages: Record<string, string> = {
  authentication_failed: "로그인 상태를 다시 확인해 주세요.",
  stale: "기획 메모가 바뀌었습니다. 최신 내용을 다시 읽은 뒤 시험해 주세요.",
  material_incomplete: "시험에 필요한 제목·썸네일·근거 메모를 먼저 채워 주세요.",
  packaging_selection_required: "선택된 제목과 썸네일 카피를 하나씩 연결해 주세요.",
  provider_not_configured: "JEV Preview 연결 설정을 확인해 주세요.",
  provider_auth_failed: "TypeSafe API 키 또는 모델 접근 권한을 확인해 주세요.",
  provider_rate_limited: "TypeSafe API 사용 한도에 도달했습니다. 사용량을 확인한 뒤 다시 시험해 주세요.",
  provider_request_rejected: "TypeSafe가 요청 형식을 거부했습니다. JEV 계약을 확인해 주세요.",
  provider_response_invalid: "TypeSafe 응답이 현재 JEV 계약과 맞지 않습니다. 결과를 적용하지 않았습니다.",
  provider_response_too_large: "TypeSafe 응답 크기가 허용 범위를 넘었습니다. 결과를 적용하지 않았습니다.",
  provider_timeout: "TypeSafe 응답 시간이 초과됐습니다. 결과를 적용하지 않았습니다.",
  provider_unavailable: "TypeSafe API가 현재 응답하지 않습니다. 결과를 적용하지 않았습니다.",
  read_failed: "저장된 기획 메모를 읽지 못했습니다. 결과를 적용하지 않았습니다.",
};

async function requestJevShadow(input: { sourceId: string; sourceVersion: number; token: string; signal: AbortSignal }) {
  const response = await fetch("/api/v1/system-one/jev-shadow", {
    method: "POST", signal: input.signal, cache: "no-store",
    headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${input.token}` },
    body: JSON.stringify({ id: input.sourceId, expectedVersion: input.sourceVersion }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const code = body?.status === "stopped" && typeof body.code === "string" ? body.code : "";
    throw new Error(stoppedMessages[code] ?? `요청을 처리하지 못했습니다. (${response.status})`);
  }
  return body as Result;
}

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
    if (busy || disabled || result) return;
    const controller = new AbortController(); active.current?.abort(); active.current = controller;
    setBusy(true); setMessage(""); setResult(null);
    try {
      const response = await requestJevShadow({ sourceId, sourceVersion, token, signal: controller.signal });
      if (!controller.signal.aborted && response.source.id === sourceId && response.source.version === sourceVersion &&
        response.evaluationProtocolVersion === "jev-packaging-review-v3" &&
        response.inputChecks?.selectedPackage === true && response.inputChecks.planningHandoff === true &&
        response.inputChecks.evidenceNotes === true && response.inputChecks.factualVerification === false &&
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
    <header><div><span className="eyebrow">DEV/QA · Shadow</span><h4>JEV 사전 평가</h4>
      <p>현재 선택한 제목·썸네일·기획 메모에 대한 모델 의견입니다. 사람의 직감 점수를 정답으로 입력하지 않습니다. 클릭률·실제 성과·정확도 또는 발행 승인으로 해석하지 마세요.</p></div>
      <button className="secondary-button" disabled={busy || disabled || Boolean(evaluation)} onClick={() => void run()}>{busy ? "평가 중…" : evaluation ? "평가 완료" : "JEV 평가 실행"}</button></header>
    <div className="jev-input-checks">
      <strong>입력 확인</strong>
      <p>서버가 선택 제목·썸네일 각 1개, 기획 인계와 근거 메모, 자료 버전·소유권을 확인한 뒤 실행합니다. 근거 메모가 있다는 사실은 원문 사실 검증을 뜻하지 않습니다.</p>
      {evaluation ? <span>연결 확인 완료 · 외부 출처 사실 확인 미실시</span> : <span>실행 전 · 자료 연결 상태 미확인</span>}
    </div>
    {evaluation ? <div role="status"><div className="jev-shadow-grid">{labels.map(([key, label]) => {
      const score = evaluation.scores[key];
      return <article key={key}><small>{label}</small><strong>{score.score.toFixed(2)}<i>/4</i></strong><span>JEV 평가 · 확신도 {Math.round(score.confidence * 100)}%</span></article>;
    })}<article className={`risk-${evaluation.overclaimRisk.choice}`}><small>과장 위험</small><strong>{riskLabels[evaluation.overclaimRisk.choice]}</strong><span>JEV 평가 · 확신도 {Math.round(evaluation.overclaimRisk.confidence * 100)}%</span><span>높음 {Math.round(evaluation.overclaimRisk.probabilities.high * 100)}% · 보완 {Math.round(evaluation.overclaimRisk.probabilities.medium * 100)}%</span></article></div>
      <p className="content-workflow-note">모델 의견에서 수정할 표현과 근거를 검토하고, 콘텐츠의 전략적 채택·수정·보류는 기존 기획 절차에서 결정합니다. 이 시험 화면은 그 결정을 기록하지 않습니다.</p>
      <p className="content-workflow-note">{evaluation.model} · {Math.round(evaluation.evaluationTimeMs)}ms · 평가 절차 {result?.evaluationProtocolVersion} · JEV 질문 {evaluation.contractVersion}. 결과는 이 화면에만 표시되고 저장·승인·단계 이동에 사용하지 않습니다.</p></div> : null}
    {message ? <p className="inline-alert warning" role="status">{message}</p> : null}
  </section>;
}
