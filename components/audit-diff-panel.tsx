"use client";

import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { auditFieldLabels } from "@/lib/audit-labels";
import { diffMarkdownLines } from "@/lib/line-diff";

type RecordDiff = { kind: "record"; subjectId: string; currentVersion: number; restoreVersion: number | null; fields: Array<{ field: string; before: unknown; after: unknown }> };
type DocumentDiff = { kind: "document"; subjectId: string; currentVersion: number; restoreVersion: number | null; before: { title: string; content: string } | null; after: { title: string; content: string } };
type AuditDiff = RecordDiff | DocumentDiff;

function readable(value: unknown) {
  if (value === null || value === undefined) return "없음";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function AuditDiffPanel({ eventId, token, onRestored }: { eventId: string; token: string | null; onRestored: () => void }) {
  const [diff, setDiff] = useState<AuditDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    setDiff(null); setLoading(true); setError(""); setNotice(""); setReason("");
    apiRequest<AuditDiff>(`/api/v1/audit/diff?eventId=${encodeURIComponent(eventId)}`, { token })
      .then((result) => { if (active) setDiff(result); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "차이를 불러오지 못했습니다."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [eventId, token]);
  const lines = useMemo(() => diff?.kind === "document" && diff.before ? diffMarkdownLines(diff.before.content, diff.after.content) : [], [diff]);
  const restore = async () => {
    if (!diff?.restoreVersion || !reason.trim()) return;
    setBusy(true); setError("");
    try {
      if (diff.kind === "document") {
        const result = await apiRequest<{ proposal?: unknown }>(`/api/v1/documents/${encodeURIComponent(diff.subjectId)}/versions`, {
          method: "POST", token, body: JSON.stringify({ version: diff.restoreVersion, expectedVersion: diff.currentVersion, reason: reason.trim() }),
        });
        setNotice(result.proposal ? "정본 복원 변경 제안을 저장했습니다. 승인 전까지 기존 정본은 유지됩니다." : "이전 내용을 새 문서 버전으로 복원했습니다.");
      } else {
        await apiRequest(`/api/v1/records/${encodeURIComponent(diff.subjectId)}/versions`, {
          method: "POST", token, body: JSON.stringify({ version: diff.restoreVersion, expectedVersion: diff.currentVersion, reason: reason.trim() }),
        });
        setNotice("이전 내용을 새 운영 기록 버전으로 복원했습니다.");
      }
      onRestored();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "이전 버전으로 복원하지 못했습니다."); }
    finally { setBusy(false); }
  };
  if (loading) return <p role="status">버전 차이를 확인하는 중입니다.</p>;
  if (!diff) return <p className="inline-alert">{error || "이 항목은 비교 가능한 버전이 없습니다."}</p>;
  return <section className="audit-diff"><h3>변경 전·후 차이</h3>
    {diff.kind === "record" ? <div className="audit-field-diff">{diff.fields.length ? diff.fields.map((field) => <div key={field.field}><strong>{auditFieldLabels([field.field])[0] || field.field}</strong><span>전: {readable(field.before)}</span><span>후: {readable(field.after)}</span></div>) : <p>비교 가능한 일반 필드의 변경이 없습니다.</p>}</div> : <>
      {diff.before?.title !== diff.after.title ? <p>제목: {diff.before?.title || "없음"} → {diff.after.title}</p> : null}
      <div className="knowledge-proposal-lines" aria-label="문서 줄 단위 차이">{lines.filter((line, index) => line.kind !== "same" || lines.slice(Math.max(0, index - 2), index + 3).some((near) => near.kind !== "same")).map((line, index) => <div key={`${line.kind}-${line.oldLine}-${line.newLine}-${index}`} className={`knowledge-proposal-line ${line.kind}`}><span>{line.oldLine ?? ""}</span><span>{line.newLine ?? ""}</span><b aria-hidden="true">{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</b><code>{line.text || " "}</code></div>)}</div>
      {!lines.some((line) => line.kind !== "same") ? <p>본문은 동일합니다.</p> : null}
    </>}
    {diff.restoreVersion ? <div className="audit-restore"><label>복원 사유<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="왜 이전 내용으로 돌아가는지 적어 주세요" /></label><button className="secondary-button" type="button" disabled={busy || !reason.trim()} onClick={() => void restore()}>{busy ? "복원 중…" : "이 변경 전으로 복원"}</button><small>기존 버전을 지우지 않고 새 버전으로 남깁니다. 정본은 변경 제안으로 보냅니다.</small></div> : <p>이 변경 전의 버전을 확인할 수 없어 복원할 수 없습니다.</p>}
    {notice ? <p className="inline-alert success" role="status">{notice}</p> : null}
    {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
  </section>;
}
