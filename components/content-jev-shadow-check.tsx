"use client";

import { useEffect, useRef, useState } from "react";

type Score = { score: number; confidence: number };
type ScoreKey = "topicRelevance" | "thumbnailClarity" | "curiosityStrength" | "evidenceBoundary";
type HumanScores = Record<ScoreKey, "" | "0" | "1" | "2" | "3" | "4">;
type RiskChoice = "" | "low" | "medium" | "high";
type Result = {
  status: "ready";
  source: { id: string; version: number };
  shadowEvaluation: {
    contractVersion: string; mode: "shadow"; policyStatus: "pilot_noncanonical";
    executionAllowed: false; judgment: null; model: string;
    scores: { topicRelevance: Score; thumbnailClarity: Score; curiosityStrength: Score; evidenceBoundary: Score };
    overclaimRisk: { choice: "low" | "medium" | "high"; confidence: number; probabilities: { low: number; medium: number; high: number } };
    usage: { input_tokens: number; output_tokens: number }; evaluationTimeMs: number;
  };
};

const labels = [
  ["topicRelevance", "주제 관련성"], ["thumbnailClarity", "썸네일 명확성"],
  ["curiosityStrength", "궁금증"], ["evidenceBoundary", "근거 경계"],
] as const satisfies ReadonlyArray<readonly [ScoreKey, string]>;
const labelDescriptions: Record<ScoreKey, string> = {
  topicRelevance: "이 주제가 시청자의 현재 일과 판단에 직접 관련되는가",
  thumbnailClarity: "제목 없이 썸네일만 봐도 핵심 문제가 보이는가",
  curiosityStrength: "제목과 썸네일이 답을 확인하고 싶게 만드는가",
  evidenceBoundary: "사실·시나리오·해석의 경계가 분명한가",
};
const riskLabels = { low: "낮음", medium: "보완 필요", high: "높음" } as const;
const riskOptions = [
  ["", "선택"],
  ["low", "낮음 · 현재 표현 사용 가능"],
  ["medium", "보완 필요 · 단서 추가 후 사용"],
  ["high", "높음 · 핵심 표현을 바꿔야 함"],
] as const;
const emptyHumanScores = (): HumanScores => ({ topicRelevance: "", thumbnailClarity: "", curiosityStrength: "", evidenceBoundary: "" });
const scoreOptions = [["", "선택"], ["0", "0 · 매우 낮음"], ["1", "1 · 낮음"], ["2", "2 · 보통"], ["3", "3 · 높음"], ["4", "4 · 매우 높음"]] as const;
const stoppedMessages: Record<string, string> = {
  authentication_failed: "로그인 상태를 다시 확인해 주세요.",
  stale: "기획 메모가 바뀌었습니다. 최신 내용을 다시 읽은 뒤 시험해 주세요.",
  material_incomplete: "시험에 필요한 제목·썸네일·근거 메모를 먼저 채워 주세요.",
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
  const [humanScores, setHumanScores] = useState<HumanScores>(emptyHumanScores);
  const [humanRisk, setHumanRisk] = useState<RiskChoice>("");
  const [humanReason, setHumanReason] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    setResult(null); setMessage("");
    setHumanScores(emptyHumanScores()); setHumanRisk(""); setHumanReason("");
    active.current?.abort(); active.current = null; setBusy(false);
    return () => { active.current?.abort(); };
  }, [sourceId, sourceVersion]);
  if (process.env.NEXT_PUBLIC_SYSTEM_ONE_JEV_SHADOW_ENABLED !== "true") return null;

  async function run() {
    if (busy || disabled) return;
    if (labels.some(([key]) => humanScores[key] === "") || humanRisk === "" || humanReason.trim().length < 10) {
      setMessage("JEV 결과를 보기 전에 사람 판정 5개와 판정 이유를 먼저 입력해 주세요.");
      return;
    }
    const controller = new AbortController(); active.current?.abort(); active.current = controller;
    setBusy(true); setMessage(""); setResult(null);
    try {
      const response = await requestJevShadow({ sourceId, sourceVersion, token, signal: controller.signal });
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
    <header><div><span className="eyebrow">DEV/QA · Shadow</span><h4>JEV 블라인드 비교</h4>
      <p>모델 결과를 보기 전에 사람 판정을 고정하고 같은 입력의 JEV 점수와 나란히 비교합니다. 승인·저장·단계 이동에는 사용하지 않습니다.</p></div>
      <button className="secondary-button" disabled={busy || disabled || Boolean(evaluation)} onClick={() => void run()}>{busy ? "판정 중…" : evaluation ? "비교 완료" : "사람 판정 고정 후 JEV 비교"}</button></header>
    <fieldset className="jev-human-labels" disabled={busy || disabled || Boolean(evaluation)}>
      <legend>모델 결과 보기 전 사람 판정</legend>
      <p>현재 보이는 제목·썸네일·기획 메모만 기준으로 입력합니다. 페이지를 벗어나면 사라지며 평가 데이터로 저장되지 않습니다.</p>
      <div>{labels.map(([key, label]) => <label key={key}><span>{label}</span><small>{labelDescriptions[key]}</small><select aria-label={`사람 판정 · ${label}`} value={humanScores[key]}
        onChange={(event) => { setHumanScores((current) => ({ ...current, [key]: event.target.value as HumanScores[ScoreKey] })); setMessage(""); }}>
        {scoreOptions.map(([value, text]) => <option key={value || "empty"} value={value}>{text}</option>)}</select></label>)}
        <label><span>과장 위험</span><small>낮음: 현재 표현 사용 가능 · 보완 필요: 조건·근거 단서 추가 후 사용 · 높음: 단서만으로 부족해 핵심 표현 수정</small><select aria-label="사람 판정 · 과장 위험" value={humanRisk}
          onChange={(event) => { setHumanRisk(event.target.value as RiskChoice); setMessage(""); }}>
          {riskOptions.map(([value, text]) => <option key={value || "empty"} value={value}>{text}</option>)}
        </select></label></div>
      <label className="jev-human-reason"><span>판정 이유·문제 표현</span><small>점수와 과장 위험을 그렇게 선택한 이유를 적습니다. 문제 표현이 없으면 없다고 적어 주세요. 10자 이상이며 결과와 함께 이 화면에만 남습니다.</small><textarea aria-label="사람 판정 · 이유" rows={3} maxLength={1000} value={humanReason}
        onChange={(event) => { setHumanReason(event.target.value); setMessage(""); }} /></label>
    </fieldset>
    {evaluation ? <div role="status"><div className="jev-shadow-grid">{labels.map(([key, label]) => {
      const score = evaluation.scores[key];
      const human = Number(humanScores[key]);
      return <article key={key}><small>{label}</small><strong>{score.score.toFixed(2)}<i>/4</i></strong><span>사람 {human}/4 · 차이 {Math.abs(score.score - human).toFixed(2)}</span><span>JEV 확신도 {Math.round(score.confidence * 100)}%</span></article>;
    })}<article className={`risk-${evaluation.overclaimRisk.choice}`}><small>과장 위험</small><strong>{riskLabels[evaluation.overclaimRisk.choice]}</strong><span>사람 {humanRisk ? riskLabels[humanRisk] : "미입력"}</span><span>높음 {Math.round(evaluation.overclaimRisk.probabilities.high * 100)}% · 보완 {Math.round(evaluation.overclaimRisk.probabilities.medium * 100)}%</span></article></div>
      <p className="jev-human-reason-result"><strong>사람 판정 이유</strong><span>{humanReason.trim()}</span></p>
      <p className="content-workflow-note">{evaluation.model} · {Math.round(evaluation.evaluationTimeMs)}ms · 시험 계약 {evaluation.contractVersion}. 이 결과는 대표 판단이나 승인 기록이 아닙니다.</p></div> : null}
    {message ? <p className="inline-alert warning" role="status">{message}</p> : null}
  </section>;
}
