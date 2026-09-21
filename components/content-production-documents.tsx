"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { updateRecord } from "@/lib/api-client";
import { addProductionLink, removeProductionLink, productionDocumentId, productionDocumentRoles, productionDocumentSummarySchema, readProductionLinks, type ProductionDocumentSummary } from "@/lib/content-production-links";
import type { OsRecord } from "@/lib/record-types";

export function ContentProductionDocuments({ source, token, disabled, onSaved }: { source: OsRecord; token: string; disabled: boolean; onSaved: (record: OsRecord) => void }) {
  const links = readProductionLinks(source.metadata.productionDocumentLinks);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [checked, setChecked] = useState<Record<string, ProductionDocumentSummary | null>>({});
  const request = useRef(0), running = useRef(false);
  useEffect(() => {
    const invalidate = () => { request.current++; running.current = false; };
    invalidate(); setChecked({}); setError(""); setBusy(false); return invalidate;
  }, [source.id, source.version, token, disabled]);
  async function read(id: string) {
    const response = await fetch(`/api/v1/system-one/production-document?id=${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    const body = await response.json();
    if (!response.ok || body.status !== "ready" || body.executionAllowed !== false || body.judgment !== null || body.policyStatus !== "unverified") throw new Error("문서를 읽지 못했습니다. 문서 링크·접근 권한·보관 상태를 확인해 주세요.");
    const summary = productionDocumentSummarySchema.parse(body.document);
    if (summary.id !== id) throw new Error("요청한 문서와 일치하지 않습니다.");
    return summary;
  }
  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (running.current || disabled || !links) return;
    const form = new FormData(event.currentTarget), serial = ++request.current;
    running.current = true; setBusy(true); setError("");
    try {
      const document = await read(productionDocumentId(String(form.get("document") ?? "")));
      if (serial !== request.current) return;
      const update = addProductionLink(source, document, String(form.get("role")));
      const result = await updateRecord(token, update);
      if (serial === request.current) onSaved(result.record);
    } catch (reason) { if (serial === request.current) setError(reason instanceof Error ? reason.message : "연결을 저장하지 못했습니다."); }
    finally { if (serial === request.current) { running.current = false; setBusy(false); } }
  }
  async function check(id: string) {
    if (running.current || disabled) return;
    const serial = ++request.current; running.current = true; setBusy(true); setError("");
    setChecked(current => ({ ...current, [id]: null }));
    try { const document = await read(id); if (serial === request.current) setChecked(current => ({ ...current, [id]: document })); }
    catch { if (serial === request.current) setError("현재 문서를 확인하지 못했습니다. 이전 연결 정보는 검수 완료의 근거가 아닙니다."); }
    finally { if (serial === request.current) { running.current = false; setBusy(false); } }
  }
  async function disconnect(id: string) {
    if (running.current || disabled) return;
    const serial = ++request.current; running.current = true; setBusy(true); setError("");
    try { const result = await updateRecord(token, removeProductionLink(source, id)); if (serial === request.current) onSaved(result.record); }
    catch { if (serial === request.current) setError("연결을 해제하지 못했습니다. 최신 기획 메모를 다시 읽어 확인해 주세요."); }
    finally { if (serial === request.current) { running.current = false; setBusy(false); } }
  }
  return <section className="panel" aria-label="설계표·원고 문서 연결">
    <div className="panel-header"><div><h3>설계표·원고 문서 연결</h3><p>원문은 지식 작업공간에 유지 · DEV 검수용</p></div></div>
    <p>이 주제에서 사용하는 문서를 직접 지정합니다. 제목·폴더명으로 추측하지 않으며 연결은 승인·내용 검증·공유 권한 부여가 아닙니다. 칠판형도 필요한 진행 메모만 연결할 수 있습니다.</p>
    {!links ? <p role="alert">기존 연결 형식을 확인할 수 없어 덮어쓰지 않습니다.</p> : <>
      {links.length ? <ul>{links.map(link => <li key={link.documentId}>
        <Link href={`/knowledge?document=${encodeURIComponent(link.documentId)}`}>{productionDocumentRoles[link.role]} · {checked[link.documentId]?.title ?? `문서 ${link.documentId.slice(0, 8)}`}</Link>
        <p>연결 당시 문서 v{link.documentVersion} · 주제 v{link.sourceVersion}</p>
        {source.version !== link.sourceVersion ? <p>연결 이후 주제 버전이 바뀌었습니다. 제작 형식·기획·다른 연결 수정 등의 영향을 확인해 주세요. 이 문서를 반드시 고쳐야 한다는 뜻은 아닙니다.</p> : null}
        {checked[link.documentId] ? <p role="status">현재 문서 v{checked[link.documentId]!.version} · {checked[link.documentId]!.version === link.documentVersion ? "연결 당시 버전과 같습니다. 내용 검수 완료는 아닙니다." : "문서 버전이 바뀌었습니다. 연결 당시와 달라진 내용을 확인해 주세요."}</p> : <p>현재 접근·문서 버전 미확인</p>}
        <button type="button" className="ghost-button" disabled={busy || disabled} onClick={() => void check(link.documentId)}>현재 문서 확인</button>
        <button type="button" className="ghost-button" disabled={busy || disabled} onClick={() => void disconnect(link.documentId)}>연결만 해제 · 원문 유지</button>
      </li>)}</ul> : <p>직접 연결한 설계표·원고 문서가 없습니다. 제작 공정 원고와는 별도 연결입니다.</p>}
      <form onSubmit={connect}><fieldset className="planning-handoff-fields" disabled={busy || disabled || links.length >= 12}>
        <label><span>문서 용도</span><select name="role" defaultValue="design">{Object.entries(productionDocumentRoles).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label><span>OS 문서 링크 또는 문서 ID</span><input name="document" required maxLength={2000} placeholder="지식 작업공간의 문서 링크" /></label>
        <button className="secondary-button" type="submit">{busy ? "확인 중…" : "문서 확인 후 연결 저장"}</button>
      </fieldset></form>
      {links.length >= 12 ? <p>연결은 최대 12개입니다.</p> : null}
    </>}
    {error ? <p className="inline-alert warning" role="alert">{error}</p> : null}
    <p>연결에는 문서 ID·용도·당시 버전만 저장합니다. 원문 수정·복제·생성은 하지 않습니다. 현재 버전 확인은 연결 당시 버전이나 승인 상태를 갱신하지 않습니다. 문서나 용도를 바꾸려면 연결만 해제하고 다시 지정해 주세요.</p>
  </section>;
}
