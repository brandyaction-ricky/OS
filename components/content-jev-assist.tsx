"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { apiRequest, ApiRequestError } from "@/lib/api-client";
import { useSession } from "./session-provider";

type ScoreAnswer = { score: number; confidence: number; probabilities: Record<string, number>; legend: Record<string, unknown> };
type Evaluation = {
  model: string;
  scores: { topicRelevance: ScoreAnswer; thumbnailClarity: ScoreAnswer; curiosityStrength: ScoreAnswer; evidenceBoundary: ScoreAnswer };
  overclaimRisk: { choice: "low" | "medium" | "high"; confidence: number; probabilities: Record<string, number> };
  evaluationTimeMs: number;
  advisoryOnly: true;
  saved: false;
};
type EvaluationResponse = { status: "ready"; shadowEvaluation: Evaluation };

const labels: Array<[keyof Evaluation["scores"], string]> = [
  ["topicRelevance", "주제 적합성"], ["thumbnailClarity", "썸네일만으로 내용 이해"],
  ["curiosityStrength", "궁금증 유발"], ["evidenceBoundary", "근거와 표현의 경계"],
];
const riskLabels = { low: "낮음", medium: "보완 필요", high: "높음" } as const;
const riskMeaning = {
  low: "표현이 입력된 근거 범위와 대체로 맞는다는 의견입니다.",
  medium: "핵심 표현은 유지하되 조건이나 근거 단서를 더하라는 의견입니다.",
  high: "단서를 붙이는 것만으로 부족해 제목·썸네일의 핵심 표현을 바꾸라는 의견입니다.",
} as const;
const errorMessages: Record<string, string> = {
  packaging_selection_required: "제목과 썸네일 카피를 각각 하나씩 채택해 주세요.",
  stale: "콘텐츠나 패키징이 바뀌었습니다. 화면을 새로고침한 뒤 다시 눌러 주세요.",
  provider_not_configured: "JEV 연결 설정이 아직 준비되지 않았습니다.",
  provider_auth_failed: "JEV 연결 인증을 확인해야 합니다.",
  provider_rate_limited: "JEV 요청이 잠시 많습니다. 조금 뒤 다시 시도해 주세요.",
  provider_timeout: "JEV 응답이 늦어 완료되지 않았습니다. 다시 시도해 주세요.",
  provider_response_invalid: "JEV가 예상한 형식으로 결과를 돌려주지 않았습니다.",
};

function likelyCriterion(answer: ScoreAnswer) {
  const [value, probability] = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1])[0] ?? [];
  const criterion = answer.legend[value ?? ""];
  return `${typeof criterion === "string" ? `기준: ${criterion} · 가능성 ${Math.round((probability ?? 0) * 100)}% · ` : ""}확신도 ${Math.round(answer.confidence * 100)}%`;
}

export function ContentJevAssist({ sourceId, sourceVersion, packageId, packageVersion }: {
  sourceId: string; sourceVersion: number; packageId: string; packageVersion: number;
}) {
  const { accessToken } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);

  async function evaluate() {
    if (busy || !accessToken) return;
    setBusy(true); setError(""); setEvaluation(null);
    try {
      const result = await apiRequest<EvaluationResponse>("/api/v1/content/jev-assist", {
        method: "POST", token: accessToken,
        body: JSON.stringify({ sourceId, sourceVersion, packageId, packageVersion }),
      });
      setEvaluation(result.shadowEvaluation);
    } catch (reason) {
      const code = reason instanceof ApiRequestError ? reason.code : "";
      setError(errorMessages[code] ?? "JEV 점수를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    } finally { setBusy(false); }
  }

  return <section className="panel content-jev-assist" aria-label="JEV 콘텐츠 점수 보조 의견">
    <div className="panel-header"><div><h2>JEV 점수 보조 의견</h2><p>채택한 제목·썸네일 카피를 바탕으로 참고 점수를 보여줍니다.</p></div><Sparkles size={17} /></div>
    <div className="content-jev-assist-body">
      <p className="content-jev-disclosure">점수 보기를 누르면 주제 설명, 채택한 제목·카피, 입력된 근거 메모가 TypeSafe JEV로 전송됩니다. 결과는 저장되지 않고 승인이나 발행 여부를 결정하지 않습니다.</p>
      <button className="secondary-button" type="button" disabled={busy || !accessToken} onClick={evaluate}>{busy ? "점수 확인 중…" : evaluation ? "다시 점수 보기" : "JEV 점수 보기"}</button>
      {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
      {evaluation ? <>
        <p className="content-jev-result-note">일반 점수는 0~4점이며 숫자가 높을수록 해당 기준을 더 충족한다는 JEV 의견입니다. 과장 위험은 품질 점수가 아니라 표현이 근거를 넘어설 위험입니다.</p>
        <div className="content-jev-score-grid">{labels.map(([key, label]) => {
          const answer = evaluation.scores[key];
          return <article key={key}><span>{label}</span><strong>{answer.score.toFixed(1)}<small> / 4</small></strong><small>{likelyCriterion(answer)}</small></article>;
        })}<article className={`risk-${evaluation.overclaimRisk.choice}`}><span>과장 위험</span><strong>{riskLabels[evaluation.overclaimRisk.choice]}</strong><small>{riskMeaning[evaluation.overclaimRisk.choice]}</small><small>확신도 {Math.round(evaluation.overclaimRisk.confidence * 100)}%</small></article></div>
        <p className="content-jev-result-note">JEV가 이 기준으로 가장 가능성이 높다고 본 결과입니다. 객관적 정답이나 성과 예측이 아니라 의사결정을 돕는 의견으로 봐 주세요.</p>
      </> : null}
    </div>
  </section>;
}
