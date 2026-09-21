"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import "./content-planning-handoff.css";
import { apiRequest, updateRecord } from "@/lib/api-client";
import { contentApproaches, handoffFields, planningHandoffUpdate, productionFormats, readPlanningHandoff } from "@/lib/content-planning-handoff";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";
import { ContentPackagingEvidence } from "./content-packaging-evidence";

export function ContentPlanningHandoff({ source, onSaved, disabled = false }: { source: OsRecord; onSaved?: (record: OsRecord) => void; disabled?: boolean }) {
  const { accessToken, demo } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  const saving = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const handoff = readPlanningHandoff(source.metadata.planningHandoff);
  const invalid = source.metadata.planningHandoff != null && !handoff;
  const editable = Boolean(onSaved);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onSaved || !accessToken || demo || disabled || invalid || saving.current) return;
    const form = new FormData(event.currentTarget);
    const input = { schemaVersion: 1, ...Object.fromEntries(["productionFormat", "contentApproach", ...handoffFields.map(([key]) => key)].map(key => [key, String(form.get(key) ?? "").trim()])) };
    saving.current = true; setBusy(true); setError("");
    try {
      const { record } = await updateRecord(accessToken, planningHandoffUpdate(source, input));
      if (active.current) onSaved(record);
    } catch (reason) {
      if (active.current) setError(reason instanceof Error ? reason.message : "인계 메모를 저장하지 못했습니다.");
    } finally { saving.current = false; if (active.current) setBusy(false); }
  }
  return <section className="panel" aria-label="기획에서 제작으로 인계">
    <div className="panel-header"><div><h3>기획에서 제작으로 인계</h3><p>{source.title} · 주제 v{source.version} · DEV 검수용</p></div></div>
    <p>주제·방향 → 제목·썸네일 → 자료·축·설계 → 형식에 맞는 집필 → 검수 → 전달 범위 결정</p>
    <p>아래 내용은 작업 메모입니다. 저장은 패키징 승인·집필 시작 허가·공유 실행이 아닙니다. 단계별 완료 조건은 OS 정본으로 별도 확인합니다.</p>
    {invalid ? <p className="inline-alert danger" role="alert">인계 메모 형식을 확인할 수 없습니다. 기존 내용을 덮어쓰지 않습니다.</p> : editable ? <form className="research-brief" onSubmit={save}>
      <fieldset className="planning-handoff-fields" disabled={busy || disabled || demo || !accessToken}>
        <div className="form-grid"><label><span>제작 형식</span><select name="productionFormat" defaultValue={handoff?.productionFormat ?? "undecided"}>{Object.entries(productionFormats).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label><span>콘텐츠 접근</span><select name="contentApproach" defaultValue={handoff?.contentApproach ?? "undecided"}>{Object.entries(contentApproaches).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
        {handoffFields.map(([key, label, limit]) => <label key={key}><span>{label}</span><textarea name={key} rows={3} maxLength={limit} defaultValue={handoff?.[key] ?? ""} /></label>)}
        <button className="secondary-button" type="submit">{busy ? "저장 중…" : "제작 인계 메모 저장"}</button>
      </fieldset>
    </form> : handoff ? <dl className="planning-facts"><div><dt>제작 형식</dt><dd>{productionFormats[handoff.productionFormat]}</dd></div><div><dt>콘텐츠 접근</dt><dd>{contentApproaches[handoff.contentApproach]}</dd></div>{handoffFields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{handoff[key] || "미입력"}</dd></div>)}</dl> : <p>아직 저장된 인계 메모가 없습니다. 주제·기획에서 먼저 정리해 주세요.</p>}
    <p>칠판형은 설계·진행 메모를 중심으로 준비하며 전체 원고를 강제하지 않습니다. 원고 완성과 편집자 공유는 별개입니다.</p>
    <p>이 메모는 현재 AI 원고 생성에 자동 전달되지 않습니다.</p>
    {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
    <div className="drawer-actions"><Link className="secondary-button" href={`/content/packages?sourceId=${encodeURIComponent(source.id)}`}>제목·썸네일 작업 보기</Link>{editable ? <Link className="secondary-button" href={`/content/scripts?sourceId=${encodeURIComponent(source.id)}`}>집필 화면에서 메모 확인</Link> : <Link className="secondary-button" href="/content/topics">주제·기획으로 돌아가기</Link>}</div>
  </section>;
}

export function LinkedPlanningHandoff() {
  const { accessToken, demo } = useSession();
  const [sourceId, setSourceId] = useState("");
  const [state, setState] = useState<{ token: string; source: OsRecord; records: OsRecord[] } | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => { setSourceId(new URLSearchParams(window.location.search).get("sourceId") ?? ""); }, []);
  useEffect(() => {
    let active = true;
    setState(null); setError("");
    if (sourceId && accessToken && !demo) {
      // Existing authenticated read endpoint; no generation or approval request.
      void apiRequest<{ source: OsRecord; records: OsRecord[] }>(`/api/v1/content/pipeline?sourceId=${encodeURIComponent(sourceId)}`, { token: accessToken }).then(({ source, records }) => {
        if (!active) return;
        if (source.id !== sourceId || source.record_type !== "content_topic") throw new Error("연결된 기획 주제를 확인할 수 없습니다.");
        if (!Array.isArray(records)) throw new Error("연결된 산출물을 확인할 수 없습니다.");
        setState({ token: accessToken, source, records });
      }).catch(() => { if (active) setError("인계 메모를 불러오지 못했습니다. 로그인·주제 접근 권한을 확인해 주세요."); });
    }
    return () => { active = false; };
  }, [accessToken, demo, sourceId, revision]);
  if (!sourceId || demo || !accessToken) return null;
  return <><div className="drawer-actions"><button className="secondary-button" onClick={() => setRevision(value => value + 1)}>최신 기획 메모 다시 읽기</button></div>{error ? <p className="inline-alert danger" role="alert">{error}</p> : state?.token === accessToken ? <><ContentPlanningHandoff key={`${state.source.id}:${state.source.version}`} source={state.source} /><ContentPackagingEvidence source={state.source} records={state.records} /></> : <p role="status">기획 인계 메모를 불러오는 중입니다.</p>}</>;
}
