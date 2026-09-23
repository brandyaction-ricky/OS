"use client";

import { type FormEvent, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { copyLineage } from "@/lib/content-copy-lineage";
import type { OsRecord } from "@/lib/record-types";

export function ContentCopyLineage({ source, records, token, disabled, onSaved }: {
  source: OsRecord; records: OsRecord[]; token: string; disabled: boolean; onSaved: () => void;
}) {
  const [kind, setKind] = useState<"decision" | "publication">("decision");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const audit = copyLineage(source.id, source.owner_id, records);
  const decision = audit.decision.data;
  const publication = audit.publication.data;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || busy || disabled) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const input = kind === "decision" ? {
      kind, sourceId: source.id, expectedSourceVersion: source.version,
      decisionAt: String(values.get("date") ?? ""), evidenceUrl: String(values.get("url") ?? "").trim(),
      title: String(values.get("title") ?? "").trim(), thumbnailCopy: String(values.get("copy") ?? "").trim(),
      note: String(values.get("note") ?? "").trim(),
    } : {
      kind, sourceId: source.id, expectedSourceVersion: source.version,
      observedAt: String(values.get("date") ?? ""), videoUrl: String(values.get("url") ?? "").trim(),
      title: String(values.get("title") ?? "").trim(), thumbnailCopy: String(values.get("copy") ?? "").trim(),
      note: String(values.get("note") ?? "").trim(),
    };
    saving.current = true; setBusy(true); setMessage("");
    try {
      await apiRequest("/api/v1/content/copy-lineage", { method: "POST", token, body: JSON.stringify(input) });
      form.reset(); setOpen(false); onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "증거를 저장하지 못했습니다.");
    } finally { saving.current = false; setBusy(false); }
  }

  const comparison = audit.state === "different" ? "기록상 카피 차이 있음 — 변경 이력 확인 필요" :
    audit.state === "same" ? "입력된 두 기록의 문구 일치 — 승인·공개본 검증은 별개" :
    audit.state === "formatting_only" ? "공백·줄바꿈만 다름 — 최종 디자인 확인 필요" :
    audit.state === "partial" ? "썸네일 카피는 일치, 결정 기록의 제목은 없어 비교 불가" :
    "비교할 기록 부족 또는 형식 확인 필요";

  return <section className="panel content-workflow-panel" aria-label="결정 카피와 공개본 대조">
    <div className="panel-header"><div><h3>결정 카피 ↔ 공개본</h3><p>결정 근거와 공개본 관측을 분리 기록 · DEV 시험</p></div></div>
    <div className="content-workflow-body copy-lineage-body">
      <p>아래 증거는 사용자가 입력한 관측 기록입니다. OS가 결정 문서의 승인 상태나 YouTube 이미지 속 글자를 자동 검증한 결과가 아닙니다. 카피가 달라도 게시를 막거나 무단 변경으로 판정하지 않습니다.</p>
      <div className={`copy-lineage-status ${audit.state === "different" ? "has-difference" : ""}`} role="status"><strong>{comparison}</strong><small>결정 근거: {audit.decision.state === "loaded" ? `기록 v${audit.decision.record?.version}` : audit.decision.state === "missing" ? "없음" : "확인 필요"} · 공개본 관측: {audit.publication.state === "loaded" ? `기록 v${audit.publication.record?.version}` : audit.publication.state === "missing" ? "없음" : "확인 필요"}</small></div>
      <div className="copy-lineage-grid"><article><strong>당시 결정 기록</strong><p>{decision?.title || "제목 미기록"}</p><p>{decision?.thumbnailCopy || "카피 미기록"}</p>{decision?.note ? <p>메모: {decision.note}</p> : null}<small>{decision ? `${decision.decisionAt} · 사용자 입력` : "연결된 결정 근거 없음"}</small>{decision ? <a href={decision.evidenceUrl} target="_blank" rel="noreferrer">결정 근거 열기</a> : null}</article><article><strong>공개본 관측 기록</strong><p>{publication?.title || "제목 미기록"}</p><p>{publication?.thumbnailCopy || "카피 미기록"}</p>{publication?.note ? <p>메모: {publication.note}</p> : null}<small>{publication ? `${publication.observedAt} · 사용자 입력` : "연결된 공개본 관측 없음"}</small>{publication ? <a href={publication.videoUrl} target="_blank" rel="noreferrer">영상 열기</a> : null}</article></div>
      {audit.state === "different" ? <p className="inline-alert warning">제목: {audit.title === "different" ? "다름" : audit.title === "unverified" ? "미확인" : "같음"} · 썸네일 카피: {audit.thumbnailCopy === "different" ? "다름" : "같음"}. 누가, 언제, 왜 변경했는지는 이 비교만으로 알 수 없습니다.</p> : null}
      <button type="button" className="secondary-button" disabled={disabled || busy} onClick={() => { setOpen(value => !value); setMessage(""); }}>{open ? "기록 입력 닫기" : "근거 기록 추가"}</button>
      {open ? <form className="copy-lineage-form" onSubmit={event => void save(event)}><div className="form-grid"><label><span>기록 종류</span><select value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="decision">당시 카피 결정</option><option value="publication">공개본 관측</option></select></label><label><span>{kind === "decision" ? "결정 날짜" : "관측 날짜"}</span><input name="date" type="date" required /></label></div>
        <label><span>{kind === "decision" ? "결정 문서 주소" : "YouTube 영상 주소"}</span><input name="url" type="url" pattern="https://.*" placeholder="https://" required maxLength={2000} /></label>
        <label><span>제목 {kind === "decision" ? "(기록에 없으면 비워두기)" : ""}</span><input name="title" required={kind === "publication"} maxLength={300} /></label>
        <label><span>썸네일 카피</span><textarea name="copy" required maxLength={500} rows={2} /></label>
        <label><span>변경 경위·관측 범위 메모 (선택)</span><textarea name="note" maxLength={1000} rows={2} /></label>
        <p>저장은 새 증거 기록을 추가할 뿐 기존 패키지 선택, 발행 상태, 승인 이력과 JEV 결과를 바꾸지 않습니다. 입력한 주소의 내용은 아직 자동 대조하지 않습니다.</p>
        <button type="submit" className="secondary-button" disabled={busy || disabled}>{busy ? "기록 중…" : "증거 기록 저장"}</button></form> : null}
      {message ? <p className="inline-alert danger" role="alert">{message}</p> : null}
    </div>
  </section>;
}
