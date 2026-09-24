"use client";

import { type FormEvent, useState } from "react";
import { updateRecord } from "@/lib/api-client";
import { contentApproaches, handoffFields, planningHandoffUpdate, productionFormats, readPlanningHandoff, readProductionFormatChange } from "@/lib/content-planning-handoff";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";

export function ContentPlanningHandoff({ source, onSaved }: { source: OsRecord; onSaved?: (record: OsRecord) => void }) {
  const { accessToken, demo } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const handoff = readPlanningHandoff(source.metadata.planningHandoff);
  const invalid = source.metadata.planningHandoff != null && !handoff;
  const formatChange = readProductionFormatChange(source);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onSaved || !accessToken || demo || busy || invalid) return;
    const form = new FormData(event.currentTarget);
    const input = { schemaVersion: 1, ...Object.fromEntries(["productionFormat", "contentApproach", ...handoffFields.map(([key]) => key)].map(key => [key, String(form.get(key) ?? "").trim()])) };
    setBusy(true); setError("");
    try {
      const { record } = await updateRecord(accessToken, planningHandoffUpdate(source, input));
      onSaved(record);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "인계 메모를 저장하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <section className="panel content-handoff" aria-label="기획에서 제작으로 인계">
    <header className="panel-header"><div><h3>기획에서 제작으로 인계</h3><p>{source.title} · 주제 v{source.version} · 작업 메모(판정·승인 아님)</p></div></header>
    <div className="content-handoff-body">
      <p>제목·썸네일 → 자료·도입 → 제작 형식에 맞는 집필·설계 → 검수. 제작 형식은 작업 중 바꿀 수 있습니다.</p>
      <p>저장해도 패키징 승인, 집필 시작 허가, 편집자 공유는 실행되지 않습니다. 기존 산출물·승인 이력은 보존되며 형식을 바꾸면 기존 자료가 새 형식에 맞는지 다시 확인해야 합니다.</p>
      {formatChange ? <p className="inline-alert warning">제작 형식이 {productionFormats[formatChange.from]}에서 {productionFormats[formatChange.to]}로 바뀌었습니다. 이전에 만든 설계·원고가 현재 형식에 맞는지 살펴봐 주세요.</p> : null}
      {invalid ? <p className="inline-alert danger" role="alert">기존 메모 형식을 확인할 수 없어 덮어쓰지 않았습니다.</p> : onSaved ? <form className="research-brief" onSubmit={save}>
        <div className="form-grid"><label><span>제작 형식</span><select name="productionFormat" defaultValue={handoff?.productionFormat ?? "undecided"}>{Object.entries(productionFormats).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label><span>콘텐츠 접근</span><select name="contentApproach" defaultValue={handoff?.contentApproach ?? "undecided"}>{Object.entries(contentApproaches).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
        {handoffFields.map(([key, label, limit]) => <label key={key}><span>{label}</span><textarea name={key} rows={3} maxLength={limit} defaultValue={handoff?.[key] ?? ""} /></label>)}
        <button className="secondary-button" type="submit" disabled={busy || demo || !accessToken}>{busy ? "저장 중…" : "제작 인계 메모 저장"}</button>
      </form> : handoff ? <dl className="planning-facts"><div><dt>제작 형식</dt><dd>{productionFormats[handoff.productionFormat]}</dd></div><div><dt>콘텐츠 접근</dt><dd>{contentApproaches[handoff.contentApproach]}</dd></div>{handoffFields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd className="content-handoff-value">{handoff[key] || "미입력"}</dd></div>)}</dl> : <p>아직 인계 메모가 없습니다. 주제·기획 화면에서 정리할 수 있습니다.</p>}
      <p className="content-handoff-note">칠판형은 설계·진행 메모로 제작할 수 있어 전체 원고를 강제하지 않습니다. 이 메모는 AI 원고 생성에 자동 전달되지 않습니다.</p>
      {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
    </div>
  </section>;
}
