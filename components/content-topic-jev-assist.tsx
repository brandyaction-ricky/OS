"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { apiRequest, ApiRequestError } from "@/lib/api-client";
import { useSession } from "./session-provider";

type Criterion = { key: string; label: string; score: number | null; explanation: string; confidence: number; improvement: string };
type Evaluation = { overallScore: number | null; scale: "0~4"; evaluatedCount: number; criteria: Criterion[]; uncertainties: string[]; improvements: string[]; advisoryOnly: true; saved: false };
type EvaluationResponse = { status: "ready"; shadowEvaluation: Evaluation };

const errors: Record<string, string> = {
  stale: "주제나 기획안이 바뀌었습니다. 새로고침한 뒤 다시 확인해 주세요.",
  provider_not_configured: "JEV 연결 설정이 준비되지 않았습니다.",
  provider_auth_failed: "JEV 연결 인증을 확인해야 합니다.",
  provider_rate_limited: "JEV 요청이 잠시 많습니다. 조금 뒤 다시 시도해 주세요.",
  provider_timeout: "JEV 응답이 늦어 완료되지 않았습니다.",
  provider_response_invalid: "JEV가 예상한 형식으로 결과를 돌려주지 않았습니다.",
};

export function ContentTopicJevAssist({ topicId, topicVersion, planId, planVersion }: {
  topicId: string; topicVersion: number; planId?: string; planVersion?: number;
}) {
  const { accessToken } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);

  async function evaluate() {
    if (busy || !accessToken) return;
    setBusy(true); setError(""); setEvaluation(null);
    try {
      const result = await apiRequest<EvaluationResponse>("/api/v1/content/topic-jev-assist", {
        method: "POST", token: accessToken,
        body: JSON.stringify({ topicId, topicVersion, ...(planId && planVersion ? { planId, planVersion } : {}) }),
      });
      setEvaluation(result.shadowEvaluation);
    } catch (reason) {
      const code = reason instanceof ApiRequestError ? reason.code : "";
      setError(errors[code] ?? "JEV 의견을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    } finally { setBusy(false); }
  }

  return <section className="panel content-jev-assist topic-jev-assist" aria-label="주제 기획 JEV 점수 보조 의견">
    <div className="panel-header"><div><h2>주제·기획 점수 보조 의견</h2><p>기획 검토에 참고할 점수와 보완 아이디어입니다.</p></div><Sparkles size={17} /></div>
    <div className="content-jev-assist-body">
      <p className="content-jev-disclosure">버튼을 누르면 선택한 주제의 제목·설명, 타깃, 입구 언어, 위계, 근거 메모·근거 영상 URL, 리서치 출처 URL·분석 메모, 연결된 기획 요약·인계 메모가 TypeSafe JEV로 전송됩니다. 비어 있는 항목은 ‘미확인’으로 보냅니다. 주제 ID, 담당자, 팀, 브랜드명, 저장 기록, 제목·썸네일 후보는 보내지 않습니다. URL의 비공개 정보와 메모의 개인정보·비밀을 확인한 뒤 눌러 주세요.</p>
      <button className="secondary-button" type="button" disabled={busy || !accessToken} onClick={evaluate}>{busy ? "점수 확인 중…" : evaluation ? "다시 TypeSafe JEV에 보내기" : "TypeSafe JEV에 보내 점수 보기"}</button>
      {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
      {evaluation ? <>
        <p className="content-jev-result-note">종합 참고 점수 <strong>{evaluation.overallScore === null ? "미확인" : `${evaluation.overallScore.toFixed(1)} / ${evaluation.scale}`}</strong> · {evaluation.evaluatedCount}/5개 확인 가능 항목의 평균입니다. 항목별 평가는 제출된 정보만 본 JEV 의견입니다. 이 점수로 주제를 채택하거나 보류하지 않습니다.</p>
        <div className="topic-jev-criteria">{evaluation.criteria.map((item) => <article key={item.key}>
          <div><strong>{item.label}</strong><span>{item.score === null ? "미확인" : `${item.score} / 4`}</span></div>
          <p>{item.explanation}</p>
          <small>JEV 확신도 {Math.round(item.confidence * 100)}%</small>
        </article>)}</div>
        <div className="topic-jev-notes">
          <div><h3>불확실한 점</h3>{evaluation.uncertainties.length ? <ul>{evaluation.uncertainties.map((item) => <li key={item}>{item}</li>)}</ul> : <p>현재 입력에서 별도 불확실성이 감지되지 않았습니다.</p>}</div>
          <div><h3>보완 의견</h3>{evaluation.improvements.length ? <ul>{evaluation.improvements.map((item) => <li key={item}>{item}</li>)}</ul> : <p>낮은 점수 항목에서 바로 제안할 보완점이 없습니다.</p>}</div>
        </div>
        <p className="content-jev-result-note">결과는 화면에만 표시되며 저장·승인·채택·기획 확정·단계 이동을 하지 않습니다. 기획 담당자가 기준과 근거를 확인해 최종 판단합니다.</p>
      </> : null}
    </div>
  </section>;
}
