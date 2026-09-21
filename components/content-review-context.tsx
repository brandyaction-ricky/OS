"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { productionDocumentRoles } from "@/lib/content-production-links";
import { reviewContextChanges, reviewContextFailure, reviewContextSchema, type ReviewContext } from "@/lib/content-review-context";

export function ContentReviewContext({ sourceId, sourceVersion, token, disabled }: { sourceId: string; sourceVersion: number; token: string; disabled: boolean }) {
  const [state, setState] = useState<{ identity: string; version: number; baseline: ReviewContext; latest: ReviewContext } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const identity = `${sourceId}:${token}`;
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { setState(null); }, [identity]);
  useEffect(() => {
    // These refs track requests, not DOM nodes. Invalidate the latest request,
    // including one started after this effect, when its context is removed.
    const invalidate = () => { sequence.current++; controller.current?.abort(); };
    invalidate(); setBusy(false); setError("");
    return invalidate;
  }, [identity, sourceVersion, disabled]);
  const current = state?.identity === identity && state.version === sourceVersion ? state : null;
  async function check() {
    if (busy || disabled) return;
    const request = ++sequence.current; controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/v1/system-one/review-context?id=${encodeURIComponent(sourceId)}&version=${sourceVersion}`,
        { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: abort.signal });
      const body = await response.json();
      if (request !== sequence.current) return;
      if (!response.ok) { setError(reviewContextFailure(body?.code)); return; }
      const result = reviewContextSchema.safeParse(body);
      if (!result.success || result.data.source.id !== sourceId || result.data.source.version !== sourceVersion) {
        setError(reviewContextFailure("invalid_response")); return;
      }
      setState(previous => ({ identity, version: sourceVersion,
        baseline: previous?.identity === identity ? previous.baseline : result.data, latest: result.data }));
    } catch { if (request === sequence.current) setError(reviewContextFailure("read_failed")); }
    finally { if (request === sequence.current) setBusy(false); }
  }
  const changes = current ? reviewContextChanges(current.baseline, current.latest) : [];
  return <section className="panel" aria-label="집필 전 자료 다시 확인">
    <div className="panel-header"><div><h3>집필 전 자료 다시 확인</h3><p>자료 변경 확인 · 승인 기능 아님 · DEV 검수용</p></div></div>
    <p>본인 소유 주제·패키징, 연결된 기획 기준과 직접 지정한 설계표·원고 문서를 함께 조회합니다. 이 화면에서 처음 확인한 자료와 비교하며, 페이지를 다시 열거나 로그인 상태가 바뀌면 비교를 새로 시작합니다.</p>
    <button className="secondary-button" disabled={busy || disabled} onClick={() => void check()}>{busy ? "자료 확인 중…" : "자료 다시 확인"}</button>
    {disabled ? <p>인계 메모 수정을 마친 뒤 확인해 주세요.</p> : null}
    {error ? <p role="alert" className="inline-alert warning">{error}</p> : busy ? <p role="status">현재 자료를 읽는 중입니다. 이전 결과를 현재 확인으로 표시하지 않습니다.</p> : current ? <div role="status">
      <p>조회 시점: 주제 v{current.latest.source.version} · 패키징 {current.latest.packageCount}개 · 기획 기준 {current.latest.referenceCount}개 · 등록부 v{current.latest.registryVersion}</p>
      <p>직접 연결 문서 {current.latest.linkedDocuments.length}개 · 본문 변경 여부 포함 · 내용 적합성은 미판정</p>
      {current.latest.linkedDocuments.length ? <ul>{current.latest.linkedDocuments.map(document => <li key={document.id}>
        <Link href={`/knowledge?document=${encodeURIComponent(document.id)}`}>{productionDocumentRoles[document.role]} · {document.title}</Link>
        <p>연결 당시 v{document.linkedVersion} → 현재 v{document.version}{document.version !== document.linkedVersion ? " · 연결 이후 문서 버전 변경: 현재 내용을 확인해 주세요." : " · 연결 당시와 같은 버전"}</p>
        {document.linkedSourceVersion !== sourceVersion ? <p>연결 이후 주제 버전도 달라졌습니다. 현재 기획·제작 형식과의 적합성을 확인해 주세요.</p> : null}
      </li>)}</ul> : <p>직접 연결된 문서는 없습니다. 원고 완성을 뜻하지 않습니다.</p>}
      {changes.length ? <ul>{changes.map(change => <li key={change}>{change}</li>)}</ul> : <p>이 화면의 첫 확인과 비교해 감지된 변경이 없습니다. 검토 완료·승인·집필 허가를 뜻하지 않습니다.</p>}
    </div> : <p>아직 현재 자료를 확인하지 않았습니다. 메모를 저장했다면 다시 확인해 주세요.</p>}
    <p>실시간 감시가 아니며 조회 사이에 발생했다 되돌아온 변경은 감지하지 못할 수 있습니다. 직접 지정하지 않은 공유 자료 전체, 패키징·집필 완료 기준, 대표 승인 증거는 아직 검증하지 않습니다. 자료나 원고는 수정·삭제·생성하지 않습니다.</p>
  </section>;
}
