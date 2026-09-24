"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { contentStages, stageReferenceFailure, stageReferenceSchema, type StageReference } from "@/lib/content-stage-reference";

export function ContentStageReference({ sourceId, sourceVersion, token, disabled }: {
  sourceId: string; sourceVersion: number; token: string; disabled: boolean;
}) {
  const [stage, setStage] = useState<keyof typeof contentStages>("writing");
  const [result, setResult] = useState<{ identity: string; value: StageReference } | null>(null);
  const [error, setError] = useState<{ identity: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0), running = useRef(false), controller = useRef<AbortController | null>(null);
  const identity = `${sourceId}:${sourceVersion}:${token}:${stage}:${disabled}`;
  useEffect(() => {
    const invalidate = () => { request.current++; running.current = false; controller.current?.abort(); };
    invalidate(); setBusy(false); setResult(null); setError(null);
    return invalidate;
  }, [identity]);
  async function check() {
    if (running.current || disabled) return;
    const serial = ++request.current, abort = new AbortController(); controller.current = abort;
    running.current = true; setBusy(true); setResult(null); setError(null);
    try {
      const response = await fetch(`/api/v1/system-one/stage-reference?id=${encodeURIComponent(sourceId)}&version=${sourceVersion}&stage=${stage}`,
        { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: abort.signal });
      const body = await response.json();
      if (serial !== request.current) return;
      if (!response.ok) { setError({ identity, message: stageReferenceFailure(body?.code) }); return; }
      const parsed = stageReferenceSchema.safeParse(body);
      if (!parsed.success || parsed.data.stage !== stage || parsed.data.source.id !== sourceId || parsed.data.source.version !== sourceVersion) {
        setError({ identity, message: stageReferenceFailure("invalid_response") }); return;
      }
      setResult({ identity, value: parsed.data });
    } catch { if (serial === request.current) setError({ identity, message: stageReferenceFailure("read_failed") }); }
    finally { if (serial === request.current) { running.current = false; setBusy(false); } }
  }
  const current = result?.identity === identity ? result.value : null;
  return <section className="panel content-workflow-panel" aria-label="단계별 담당 기준">
    <div className="panel-header"><div><h3>단계별 담당 기준</h3><p>정본 연결 확인 · 완료 판정 아님 · DEV 검수용</p></div></div>
    <div className="content-workflow-body">
      <p>선택한 단계의 담당 정본과 버전을 확인합니다. 단계 선택은 조회용이며 실제 제작 단계나 제작 형식을 변경하지 않습니다.</p>
      <div className="drawer-actions">{Object.entries(contentStages).map(([key, label]) => <button type="button" className="secondary-button"
        key={key} aria-pressed={stage === key} onClick={() => setStage(key as keyof typeof contentStages)}>{label}</button>)}</div>
      <button type="button" className="secondary-button" disabled={busy || disabled} onClick={() => void check()}>{busy ? "기준 확인 중…" : "담당 정본 확인"}</button>
      {disabled ? <p>인계 메모 수정을 마친 뒤 확인해 주세요.</p> : null}
      {error?.identity === identity ? <p role="alert" className="inline-alert warning">{error.message}</p> : busy ? <p role="status">현재 기준을 읽는 중입니다. 이전 결과는 사용하지 않습니다.</p> : current ? <div role="status">
        <p>{contentStages[current.stage]} 담당 정본 · <Link href={`/knowledge?document=${encodeURIComponent(current.entryDocument.id)}`}>{current.entryDocument.title}</Link> · v{current.entryDocument.version}</p>
        <p>조회한 주제 v{current.source.version} · 등록부 v{current.registryVersion}</p>
        <ul><li>단계별 필수 자료·제작 형식별 예외: 아직 대조하지 않았습니다.</li><li>대표 승인 근거: 아직 확인하지 않았습니다.</li></ul>
      </div> : <p>아직 이 단계의 담당 정본을 확인하지 않았습니다.</p>}
      <p className="content-workflow-note">정본을 읽었다는 사실만으로 내용 적합성·집필 준비·승인 완료를 판단하지 않습니다. 원고 생성이나 다음 단계 실행도 하지 않습니다.</p>
    </div>
  </section>;
}
