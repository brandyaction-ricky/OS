"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, CheckCheck, FileText, FlaskConical, History, LockKeyhole, ShieldCheck } from "lucide-react";
import {
  CHECK_LABELS, JUDGMENT_LABELS, mockInputSignature, recordMockDecision, runMockJudgment, viewMockRun,
  type HumanDecision, type Judgment, type MockInput, type RunResult,
} from "@/lib/system-one";
import { createMockInput, MOCK_SCENARIOS } from "@/lib/system-one-fixtures";
import styles from "./system-one-sandbox.module.css";

type Attempt = { id: string; scenarioId: string; signature: string; at: string; result: RunResult };
const kindLabels = { fact: "사실", interpretation: "해석", hypothesis: "가설" } as const;
const availabilityLabels = { read: "본문 확인", not_opened: "미열람", not_found: "찾지 못함", retrieval_error: "조회 오류" } as const;
const applicabilityLabels = { applies: "적용", not_applicable: "적용 제외", exception: "예외", unknown: "미확인" } as const;
const formatLabels = { information: "정보형", board: "칠판형", script: "원고형" } as const;
const stateLabels = { current: "현행", replaced: "대체됨", protected: "보호", unknown: "미확인" } as const;
const accessLabels = { allowed: "허용", denied: "취소", unknown: "미확인" } as const;
const displayVersion = (version: number | null) => version === null ? "버전 미확인" : `v${version}`;
const displayTime = (at: string) => new Date(at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function SystemOneSandbox() {
  const [scenarioId, setScenarioId] = useState("ready");
  const [input, setInput] = useState<MockInput>(() => createMockInput("ready"));
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<HumanDecision[]>([]);
  const [humanJudgment, setHumanJudgment] = useState<Judgment>("hold");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [decisionError, setDecisionError] = useState("");
  const scenario = MOCK_SCENARIOS.find((item) => item.id === scenarioId)!;
  const active = attempts.find((item) => item.id === activeId);
  const successful = active?.result.status === "succeeded" ? active.result : null;
  const view = successful ? viewMockRun(successful, input) : null;
  const revoked = input.source.access === "denied" || input.criteria.some((item) => item.document.access === "denied");
  const current = view?.state === "current";
  const visibleRun = view && view.state !== "unavailable" ? view.run : null;
  const runDecisions = visibleRun ? decisions.filter((item) => item.runId === visibleRun.id) : [];

  function reset(nextId: string) {
    setScenarioId(nextId); setInput(createMockInput(nextId)); setAttempts([]); setActiveId(null);
    setDecisions([]); setReason(""); setHumanJudgment("hold"); setNotice(""); setDecisionError("");
  }

  function execute() {
    if (revoked) return;
    const signature = mockInputSignature(input);
    const prior = attempts.findLast((item) => item.scenarioId === scenarioId && item.signature === signature && item.result.status === "succeeded");
    setDecisionError(""); setReason(""); setHumanJudgment("hold");
    if (prior) {
      setActiveId(prior.id); setNotice("같은 입력의 모의 결과를 다시 표시했습니다. 실행 이력은 추가하지 않았습니다."); return;
    }
    const id = `mock-run-${attempts.length + 1}`;
    const at = new Date().toISOString();
    const result = runMockJudgment(input, { id, at, failure: scenario.failure });
    setAttempts((items) => [...items, { id, scenarioId, signature, at, result }]);
    setActiveId(id); setNotice(result.status === "succeeded" ? "모의 검토가 완료되었습니다. 결과는 이 화면 메모리에만 있습니다." : "판단 결과가 생성되지 않았습니다. 자동 재시도하지 않습니다.");
  }

  function changeVersion(target: "source" | "criteria") {
    setInput((previous) => {
      if (target === "source") {
        const version = (previous.source.version ?? 0) + 1;
        return { ...previous, source: { ...previous.source, version, fingerprint: `synthetic-source-v${version}` } };
      }
      return { ...previous, criteria: previous.criteria.map((criterion, index) => {
        if (index !== 0) return criterion;
        const version = (criterion.document.version ?? 0) + 1;
        return { ...criterion, document: { ...criterion.document, version, fingerprint: `synthetic-criterion-v${version}` } };
      }) };
    });
    setReason(""); setDecisionError(""); setNotice("시험 입력 버전이 변경되었습니다. 기존 결과와 결정은 보존되며, 새 입력으로 다시 검토해야 합니다.");
  }

  function decide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!visibleRun || !current || revoked) return;
    const result = recordMockDecision(visibleRun, input, {
      id: `mock-decision-${decisions.length + 1}`, judgment: humanJudgment, reason, at: new Date().toISOString(),
    });
    if (!result.ok) { setDecisionError(result.message); return; }
    setDecisions((items) => [...items, result.decision]); setReason(""); setDecisionError("");
    setNotice("사람의 결정을 화면에만 기록했습니다. 모의 추천 원문은 바뀌지 않으며, 저장·공유·발행은 실행되지 않습니다.");
  }

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div className={styles.brand}><span className={styles.brandMark}>B</span><span>BRANDYACTION OS <span className={styles.brandDivider}>/</span> LOCAL LAB</span></div>
      <span className={styles.mockBadge}><FlaskConical size={14} /> 모의 검토 · 저장되지 않음</span>
    </header>
    <section className={styles.hero}>
      <span className={styles.eyebrow}>SYSTEM ONE · CONTRACT SANDBOX</span>
      <h1>판단은 근거와 함께.<br /><span>결정은 사람에게.</span></h1>
      <p>검토 입력 → 근거가 있는 추천 → 사람의 결정 기록을 시험합니다.<br className={styles.desktopBreak} /> 실제 회사 문서나 AI 모델을 연결하지 않은 로컬 실험 화면입니다.</p>
      <div className={styles.boundaries}><span><ShieldCheck size={15} /> 합성 시험 자료만 사용</span><span>외부 전송 없음</span><span>DB 저장 없음</span><span>자동 실행 없음</span></div>
    </section>
    <section className={styles.scenarioPanel} aria-label="시험 설정">
      <div><label className={styles.fieldLabel} htmlFor="mock-scenario">시험 사례</label><select id="mock-scenario" value={scenarioId} onChange={(event) => reset(event.target.value)}>{MOCK_SCENARIOS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
      <p>{scenario.description}<small>사례를 바꾸면 이 화면의 입력·실행·결정 이력이 초기화됩니다.</small></p>
    </section>
    <div className={styles.caution}><FlaskConical size={17} /><p><strong>판단 능력이 아니라 계약과 화면 흐름을 검증합니다.</strong> 사전에 정한 시험 점검값으로 추천이 결정됩니다. 문장 의미를 분석하거나 사실을 검증하는 AI가 아닙니다. 정확도·모델 비용은 미측정입니다.</p></div>
    {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    {revoked ? <section className={styles.revoked} role="alert" data-testid="mock-unavailable"><LockKeyhole size={32} /><h2>접근 취소 시험 · 내용 숨김</h2><p>입력·판단 카드·사람 결정·실행 이력의 내용을 표시하지 않습니다.</p><p>실제 OS 권한을 변경한 것은 아닙니다. 시험 사례를 다시 선택하거나 초기화하면 새 시험을 시작할 수 있습니다.</p><button className={styles.secondaryButton} onClick={() => reset(scenarioId)}>현재 사례 초기화</button></section> : <>
      <div className={styles.workspace}>
        <section className={styles.inputPanel} aria-label="검토 입력">
          <div className={styles.sectionHead}><span className={styles.step}>01</span><div><h2>무엇을 검토하나요?</h2><p>현재 요청과 적용 범위를 먼저 확인합니다.</p></div></div>
          <div className={styles.inputTitle}><FileText size={18} /><strong>{input.source.title}</strong><span className={styles.pill}>{displayVersion(input.source.version)}</span></div>
          <dl className={styles.inputSummary}><div><dt>검토 질문</dt><dd>{input.question}</dd></div><div><dt>현재 → 다음 단계</dt><dd>{input.currentStage} <ArrowRight size={13} /> {input.nextStage}</dd></div><div><dt>콘텐츠 형식</dt><dd>{formatLabels[input.format]}</dd></div><div><dt>최신 요청</dt><dd>{input.latestRequest}</dd></div></dl>
          <div className={styles.scopeGrid}><div><h3>이번에 포함</h3><ul>{input.included.map((item) => <li key={item}>{item}</li>)}</ul></div><div><h3>이번에 제외</h3><ul>{input.excluded.map((item) => <li key={item}>{item}</li>)}</ul></div></div>
          <details className={styles.detail}><summary>합성 원문 보기</summary><p className={styles.micro}>시험 상태 {stateLabels[input.source.state]} · 시험 접근 {accessLabels[input.source.access]}<br />합성 확인 시각 {input.source.checkedAt ?? "미확인"}</p><pre>{input.source.body}</pre></details>
          <details className={styles.detail}><summary>적용 기준 {input.criteria.length}개</summary>{input.criteria.map((criterion) => <div className={styles.criterion} key={criterion.document.id}><strong>{criterion.document.title} · {displayVersion(criterion.document.version)}</strong><p>{criterion.section} · {applicabilityLabels[criterion.applicability]}</p><p>{criterion.reason}</p><p className={styles.micro}>시험 상태 {stateLabels[criterion.document.state]} · 시험 접근 {accessLabels[criterion.document.access]}<br />합성 확인 시각 {criterion.document.checkedAt ?? "미확인"}</p></div>)}</details>
          <button className={styles.primaryButton} onClick={execute}><FlaskConical size={16} /> 모의 검토 실행 <ArrowRight size={16} /></button>
          <p className={styles.micro}>같은 입력의 성공 결과는 재사용합니다. 실패한 시험은 이 버튼을 다시 눌러야 재시도합니다.</p>
          <details className={styles.testControls}><summary>변경·접근 취소 시험</summary><p>화면 안의 시험 상태만 변경합니다. 실제 문서나 권한에는 영향이 없습니다.</p><div><button className={styles.secondaryButton} onClick={() => changeVersion("source")}>원문 버전 변경</button><button className={styles.secondaryButton} onClick={() => changeVersion("criteria")}>기준 버전 변경</button><button className={styles.secondaryButton} onClick={() => { setInput((previous) => ({ ...previous, source: { ...previous.source, access: "denied" } })); setNotice(""); setDecisionError(""); }}>접근 취소 시험</button></div></details>
        </section>
        <section className={styles.resultPanel} aria-label="검토 결과">
          <div className={styles.sectionHead}><span className={styles.step}>02</span><div><h2>근거가 있는 추천</h2><p>모의 추천과 사람의 결정을 구분합니다.</p></div></div>
          {!active ? <div className={styles.empty}><CheckCheck size={36} /><h3>아직 검토하지 않았습니다</h3><p>왼쪽의 시험 입력을 확인하고<br />모의 검토를 실행해 보세요.</p><span>AI 호출 0 · 외부 저장 0</span></div> : null}
          {active && active.result.status !== "succeeded" ? <div className={styles.failure} role="alert"><span className={styles.pill}>판정 없음</span><h3>{active.result.status === "failed" ? "모의 실행 실패" : "검토 시작 전 중단"}</h3><p>{active.result.message}</p><small>실패를 채택·보류 등의 판단으로 대신 표시하지 않습니다. 이력은 유지하며, 자동으로 다시 실행하지 않습니다.</small></div> : null}
          {view?.state === "unavailable" ? <div className={styles.failure} role="alert"><h3>결과를 표시할 수 없습니다</h3><p>{view.message}</p></div> : null}
          {visibleRun ? <>
            {view?.state === "stale" ? <div className={styles.stale} role="alert" data-testid="mock-stale"><strong>입력 변경 · 재검토 필요</strong><p>아래는 이전 버전의 결과입니다. 현재 입력에 대한 결정은 새 검토 후 기록할 수 있습니다.</p></div> : null}
            <section className={styles.judgmentCard} aria-label="판단 카드" data-testid="judgment-card">
              <div className={styles.judgmentHead}><div><span className={styles.eyebrow}>MOCK RECOMMENDATION</span><h3 data-testid="mock-verdict" data-judgment={visibleRun.judgment}>{JUDGMENT_LABELS[visibleRun.judgment]}</h3></div><span className={styles.pill}>{current ? "현재 입력" : "이전 입력"} · {displayVersion(visibleRun.input.source.version)}</span></div>
              <p className={styles.verdictSummary}>{visibleRun.summary}</p>
              <div className={styles.noExecution}><LockKeyhole size={14} /> 추천은 실행 권한이 아닙니다. 저장·공유·발행하지 않습니다.</div>
              <h4>점검 이유와 다음 행동</h4><div className={styles.checkList}>{visibleRun.input.checks.map((check) => <article key={check.id} className={styles.check}><header><strong>{check.label}</strong><span className={styles.pill}>{CHECK_LABELS[check.status]}</span></header><p>{check.reason}</p><p className={styles.nextAction}>다음 행동 · {check.nextAction}</p><small>연결 근거: {check.evidenceIds.length ? check.evidenceIds.map((id) => visibleRun.input.evidence.find((item) => item.id === id)?.label ?? id).join(" · ") : "없음"}</small></article>)}</div>
              <h4>근거 · 사실 / 해석 / 가설</h4><div className={styles.evidenceList}>{visibleRun.input.evidence.map((evidence) => <article key={evidence.id} className={styles.evidence}><header><strong>{evidence.label}</strong><span className={styles.pill}>{kindLabels[evidence.kind]}</span></header><p>{evidence.origin === "original" ? "원자료" : "파생자료"} · {availabilityLabels[evidence.availability]} · {displayVersion(evidence.version)}</p>{evidence.excerpt ? <blockquote>{evidence.excerpt}</blockquote> : <p className={styles.micro}>확인된 인용문이 없습니다.</p>}<small>{evidence.reference} · {evidence.section}</small></article>)}</div>
              <details className={styles.detail}><summary>이 판단 당시의 기준 버전·포함·제외 범위</summary><h4>적용 기준 버전</h4><ul>{visibleRun.input.criteria.map((criterion) => <li key={criterion.document.id}>{criterion.document.title} · {displayVersion(criterion.document.version)} · {applicabilityLabels[criterion.applicability]}</li>)}</ul><h4>포함</h4><ul>{visibleRun.input.included.map((item) => <li key={item}>{item}</li>)}</ul><h4>제외</h4><ul>{visibleRun.input.excluded.map((item) => <li key={item}>{item}</li>)}</ul></details>
              <div className={styles.measurements}><span>정확도 <strong>미측정</strong></span><span>모델 비용 <strong>미측정</strong></span><span>모드 <strong>모의</strong></span></div>
            </section>
            <section className={styles.humanPanel} aria-label="사람의 결정">
              <div className={styles.sectionHead}><span className={styles.step}>03</span><div><h2>사람의 최종 판단</h2><p>모의 추천을 덮어쓰지 않고 별도 이력으로 남깁니다.</p></div></div>
              <form onSubmit={decide}><fieldset disabled={!current} className={styles.fieldset}><label className={styles.fieldLabel} htmlFor="human-judgment">사람 판정</label><select id="human-judgment" value={humanJudgment} onChange={(event) => setHumanJudgment(event.target.value as Judgment)}>{Object.entries(JUDGMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><label className={styles.fieldLabel} htmlFor="decision-reason">결정 이유</label><textarea id="decision-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required rows={3} placeholder="추천에 동의하거나 다르게 결정한 이유를 남겨 주세요." /><button className={styles.secondaryButton} type="submit" disabled={!current || !reason.trim()}>화면에 결정 기록</button></fieldset></form>
              {decisionError ? <p role="alert" className={styles.failure}>{decisionError}</p> : null}
              <p className={styles.micro}>로컬 테스트 사용자 · 새로고침 시 사라짐 · 실제 승인 효력 없음</p>
              <div className={styles.decisions} data-testid="human-decisions">{runDecisions.length ? runDecisions.toReversed().map((decision) => <article key={decision.id}><header><strong>사람 결정 · {JUDGMENT_LABELS[decision.judgment]}</strong><small>{displayTime(decision.at)}</small></header><p>{decision.reason}</p><small>{decision.actor} · 원문 {displayVersion(decision.sourceVersion)} · 실행 없음</small></article>) : <p className={styles.micro}>이 결과에 기록된 사람 결정이 없습니다.</p>}</div>
            </section>
          </> : null}
        </section>
      </div>
      <section className={styles.historyPanel} aria-label="실행 이력"><div className={styles.historyHead}><h2><History size={17} /> 화면 내 실행 이력 <span><span data-testid="mock-run-count">{attempts.length}</span>건</span></h2><button className={styles.textButton} onClick={() => reset(scenarioId)}>현재 사례 초기화</button></div>{attempts.length ? <ol>{attempts.toReversed().map((attempt) => <li key={attempt.id}><button className={styles.historyItem} aria-pressed={activeId === attempt.id} onClick={() => { setActiveId(attempt.id); setReason(""); setDecisionError(""); setNotice(""); }}><span>{attempt.id.replace("mock-run-", "#")} <strong>{attempt.result.status === "succeeded" ? `모의 추천 · ${JUDGMENT_LABELS[attempt.result.judgment]}` : "판정 없음 · 중단/실패"}</strong></span><small>{displayTime(attempt.at)} · 사람 결정 {attempt.result.status === "succeeded" ? decisions.filter((decision) => decision.runId === attempt.id).length : 0}건</small><ArrowRight size={14} /></button></li>)}</ol> : <p className={styles.micro}>실행하면 모의 결과와 실패 이력이 여기에 표시됩니다.</p>}</section>
    </>}
    <footer className={styles.footer}>SYSTEM ONE · 로컬 계약 검증용 · 실제 접근 제어·모델·서버 저장은 연결하지 않았습니다.</footer>
  </main>;
}
