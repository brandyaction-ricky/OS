"use client";

import { type FormEvent, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { claimEvidence } from "@/lib/content-claim-evidence";
import { evidenceAuthorLabel } from "@/lib/content-evidence-author";
import type { OsRecord } from "@/lib/record-types";

const locationLabels = { title: "제목", thumbnail: "썸네일", description: "설명", chapter: "챕터", spoken: "영상 발화" } as const;
const assessmentLabels = { unverified: "미확인", review_needed: "표현 재검토", reviewer_aligned: "검토자 기록상 일치" } as const;

export function ContentClaimEvidence({ source, records, authors, viewerId, token, disabled, canWrite, onSaved }: {
  source: OsRecord; records: OsRecord[]; authors: Record<string, string>; viewerId?: string; token: string; disabled: boolean; canWrite: boolean; onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [relation, setRelation] = useState<"unlinked" | "candidate" | "identified">("unlinked");
  const [assessment, setAssessment] = useState<"unverified" | "review_needed" | "reviewer_aligned">("unverified");
  const saving = useRef(false);
  const ledger = claimEvidence(source.id, source.owner_id, records, source.team);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || disabled || !canWrite) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const field = (name: string) => String(values.get(name) ?? "").trim();
    const input = {
      sourceId: source.id, expectedSourceVersion: source.version,
      location: field("location"), locationDetail: field("locationDetail"), claimText: field("claimText"),
      sourceRelation: relation, sourceUrl: relation === "unlinked" ? "" : field("sourceUrl"),
      sourceIdentifier: relation === "unlinked" ? "" : field("sourceIdentifier"),
      sourceExcerpt: relation === "unlinked" ? "" : field("sourceExcerpt"),
      measuredConcept: field("measuredConcept"), population: field("population"), sample: field("sample"),
      comparison: field("comparison"), conditions: field("conditions"), assessment, rationale: field("rationale"),
    };
    saving.current = true; setBusy(true); setError("");
    try {
      await apiRequest("/api/v1/content/claim-evidence", { method: "POST", token, body: JSON.stringify(input) });
      form.reset(); setRelation("unlinked"); setAssessment("unverified"); setOpen(false); onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "주장 근거를 저장하지 못했습니다."); }
    finally { saving.current = false; setBusy(false); }
  }

  return <section className="panel content-workflow-panel" aria-label="주장별 근거 카드">
    <div className="panel-header"><div><h3>주장별 근거 카드</h3><p>표현 → 실제 출처 → 측정 개념·조건 · DEV 시험</p></div></div>
    <div className="content-workflow-body claim-evidence-body">
      <p>제목·썸네일·챕터·발화의 주장을 각각 기록합니다. ‘출처 후보’는 실제 인용 원문이 아닙니다. 일치 여부도 검토자가 입력한 의견이며 OS의 자동 사실 검증이나 JEV 정확도가 아닙니다.</p>
      {ledger.invalidCount ? <p className="inline-alert warning">형식을 확인할 수 없는 주장 카드 {ledger.invalidCount}건은 표시·판정에서 제외했습니다.</p> : null}
      {ledger.claims.length ? <div className="claim-evidence-list">{ledger.claims.map(({ record, data }) => <article key={record.id}>
        <div><span className="eyebrow">{locationLabels[data.location]}{data.locationDetail ? ` · ${data.locationDetail}` : ""}</span><strong>{data.claimText}</strong><span className="status-pill">{assessmentLabels[data.assessment]}</span></div>
        <p>출처: {data.sourceRelation === "unlinked" ? "미연결" : data.sourceRelation === "candidate" ? "후보 — 실제 인용 여부 미확인" : "검토자가 실제 인용 원문으로 식별"}{data.sourceIdentifier ? ` · ${data.sourceIdentifier}` : ""}</p>
        {data.measuredConcept ? <p>측정 개념: {data.measuredConcept}</p> : null}
        {data.population || data.sample ? <p>대상·표본: {[data.population, data.sample].filter(Boolean).join(" · ")}</p> : null}
        {data.comparison || data.conditions ? <p>비교·조건: {[data.comparison, data.conditions].filter(Boolean).join(" · ")}</p> : null}
        {data.sourceExcerpt ? <details><summary>연결된 원문 대목 보기</summary><p>{data.sourceExcerpt}</p></details> : null}
        {data.rationale ? <p>검토 이유: {data.rationale}</p> : null}
        <small>{evidenceAuthorLabel(record, authors, viewerId)} · 검토자 입력 · {new Date(record.created_at).toLocaleString("ko-KR")}</small>
        {data.sourceUrl ? <a href={data.sourceUrl} target="_blank" rel="noreferrer">연결된 원문 열기</a> : null}
      </article>)}</div> : <p>아직 연결된 주장 카드가 없습니다. 근거 메모가 있다는 사실만으로 주장 검증을 완료하지 않습니다.</p>}
      {canWrite ? <button type="button" className="secondary-button" disabled={disabled || busy} onClick={() => { setOpen(value => !value); setError(""); }}>{open ? "카드 작성 닫기" : "주장 근거 추가"}</button> : null}
      {open && canWrite ? <form className="claim-evidence-form" onSubmit={event => void save(event)}>
        <div className="form-grid"><label><span>표현 위치</span><select name="location" required>{Object.entries(locationLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label><span>챕터 시각·문장 위치 (선택)</span><input name="locationDetail" maxLength={200} placeholder="예: 8:57 챕터" /></label></div>
        <label><span>검토할 주장 원문</span><textarea name="claimText" required maxLength={1000} rows={2} /></label>
        <div className="form-grid"><label><span>원출처 연결 상태</span><select value={relation} onChange={event => setRelation(event.target.value as typeof relation)}><option value="unlinked">원출처 미연결</option><option value="candidate">출처 후보</option><option value="identified">실제 인용 원문으로 식별</option></select></label><label><span>검토 상태</span><select value={assessment} onChange={event => setAssessment(event.target.value as typeof assessment)}><option value="unverified">미확인</option><option value="review_needed">표현 재검토</option><option value="reviewer_aligned">검토자 기록상 일치</option></select></label></div>
        {relation !== "unlinked" ? <div className="claim-source-fields"><label><span>원출처 HTTPS 주소</span><input name="sourceUrl" type="url" pattern="https://.*" required maxLength={2000} /></label><label><span>원출처 식별자·제목</span><input name="sourceIdentifier" required maxLength={300} placeholder="예: 논문명·DOI" /></label><label><span>해당 원문 대목 (일치 검토 시 필수)</span><textarea name="sourceExcerpt" maxLength={1500} rows={2} /></label></div> : null}
        <div className="form-grid"><label><span>실제로 측정한 개념</span><input name="measuredConcept" maxLength={500} placeholder="예: 미래 감정 예측 오차" /></label><label><span>연구 대상·적용 범위</span><input name="population" maxLength={500} /></label><label><span>표본·분모</span><input name="sample" maxLength={300} /></label><label><span>비교 수치·단위</span><input name="comparison" maxLength={700} /></label></div>
        <label><span>주요 조건·예외</span><textarea name="conditions" maxLength={700} rows={2} /></label><label><span>검토 이유 {assessment === "unverified" ? "(선택)" : "(필수)"}</span><textarea name="rationale" required={assessment !== "unverified"} minLength={assessment === "reviewer_aligned" ? 20 : assessment === "review_needed" ? 10 : undefined} maxLength={1500} rows={2} /></label>
        <p>‘일치’는 실제 인용 원문·해당 대목·측정 개념·20자 이상 이유가 있을 때만 기록됩니다. 저장 후 정정은 새 카드로 남깁니다. 승인·발행 상태는 바뀌지 않습니다.</p>
        <button type="submit" className="secondary-button" disabled={busy || disabled}>{busy ? "기록 중…" : "주장 카드 저장"}</button>
      </form> : null}
      {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
    </div>
  </section>;
}
