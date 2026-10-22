"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Search } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import { documentHref, kstTime } from "@/lib/knowledge/model";
import type { KnowledgeDocument } from "@/lib/types";
import { useKnowledge } from "./provider";
import { Modal } from "./ui";

type Link = { id: string; createdBy: string; createdAt: string; expiresAt: string; revokedAt: string | null };
type Share = { canShareNote: boolean; canLink: boolean; readerIds: string[]; links: Link[] };

// Some browsers refuse the clipboard API inside a dialog or an embedded window; then copy the
// selected text of the field itself.
async function copyField(input: HTMLInputElement | null, text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  if (!input) return false;
  input.focus(); input.select(); input.setSelectionRange(0, text.length);
  try { return document.execCommand("copy"); } catch { return false; }
}

function CopyField({ label, value, onCopied }: { label: string; value: string; onCopied: (ok: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null), [done, setDone] = useState(false);
  return <div className="kw-share-field"><input ref={ref} aria-label={label} readOnly value={value} onFocus={e => e.currentTarget.select()} />
    <button type="button" onClick={() => void copyField(ref.current, value).then(ok => { onCopied(ok); if (ok) { setDone(true); window.setTimeout(() => setDone(false), 1500); } })}>
      {done ? <Check size={14} /> : <Copy size={14} />}{done ? "복사됨" : "복사"}</button></div>;
}

// Three ways to share one document: the internal address, read-only sharing of a personal note
// with named staff, and an external link anyone can open until it expires or is revoked.
export function DocumentShareDialog({ document: doc, close }: { document: KnowledgeDocument; close: () => void }) {
  const { state, actor, token, notify } = useKnowledge();
  const [share, setShare] = useState<Share | null>(null), [readers, setReaders] = useState<string[]>([]), [query, setQuery] = useState("");
  const [days, setDays] = useState<1 | 7 | 30>(7), [created, setCreated] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const internal = typeof window === "undefined" ? "" : `${window.location.origin}${documentHref(doc)}`;
  const staff = state.people.filter(p => p.member_kind !== "partner" && p.id !== actor.ownerId);
  const shown = staff.filter(p => p.display_name.toLowerCase().includes(query.trim().toLowerCase()));
  const name = (id: string) => state.people.find(p => p.id === id)?.display_name ?? "구성원";
  const load = useCallback(async () => {
    try { const result = await apiRequest<Share>(`/api/v1/documents/share?documentId=${doc.id}`, { token }); setShare(result); setReaders(result.readerIds); }
    catch (e) { setError((e as Error).message); }
  }, [doc.id, token]);
  useEffect(() => { void load(); }, [load]);
  const copied = (label: string) => (ok: boolean) => { if (ok) { setError(""); notify(`${label}를 복사했습니다`); } else setError("복사하지 못했습니다. 주소 칸을 눌러 선택한 뒤 직접 복사해 주세요."); };
  const run = async (body: Record<string, unknown>, done: (result: { url?: string }) => void) => {
    setBusy(true); setError("");
    try { done(await apiRequest(`/api/v1/documents/share`, { method: "POST", token, body: JSON.stringify({ documentId: doc.id, ...body }) })); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const live = (share?.links ?? []).filter(link => !link.revokedAt && Date.parse(link.expiresAt) > Date.now());
  const changed = share && (readers.length !== share.readerIds.length || readers.some(id => !share.readerIds.includes(id)));
  return <Modal title="공유·링크" onClose={close} busy={busy}><div className="kw-modal-body kw-share">
    <section><h3>사내 링크</h3><p>열람 권한이 있는 직원만 열 수 있습니다.</p>
      <CopyField label="사내 링크" value={internal} onCopied={copied("사내 링크")} /></section>
    <section><h3>특정 직원에게 공유</h3>
      {!share ? <p>불러오는 중…</p> : share.canShareNote ? <>
        <p>고른 직원은 이 노트를 읽기만 할 수 있습니다. 언제든 해제할 수 있습니다.</p>
        <div className="kw-share-people">
          {staff.length > 8 && <label className="kw-share-search"><Search size={14} /><input aria-label="직원 찾기" placeholder="이름으로 찾기" value={query} onChange={e => setQuery(e.target.value)} /></label>}
          <div className="kw-share-list" role="group" aria-label="공유할 직원">{shown.length ? shown.map(p => <label key={p.id} className={readers.includes(p.id) ? "on" : ""}>
            <input type="checkbox" checked={readers.includes(p.id)} onChange={e => setReaders(e.target.checked ? [...readers, p.id] : readers.filter(id => id !== p.id))} /><span>{p.display_name}</span></label>)
            : <small>일치하는 직원이 없습니다.</small>}</div>
        </div>
        <div className="kw-share-row"><small>{readers.length ? `${readers.length}명에게 공유${changed ? " · 저장 전" : ""}` : changed ? "공유 해제 · 저장 전" : "아직 공유하지 않았습니다"}</small>
          <button className="kw-primary" disabled={busy || !changed} onClick={() => void run({ action: "readers", readerIds: readers }, () => notify(readers.length ? `${readers.length}명에게 공유했습니다` : "공유를 해제했습니다"))}>저장</button></div>
      </> : <p>{doc.status === "draft" ? "작성자만 직원에게 공유할 수 있습니다." : doc.status === "canonical" ? "회사 정본의 열람 범위는 관리자가 ‘열람 범위’에서 정합니다." : "팀 문서는 이미 모든 직원이 볼 수 있습니다."}</p>}</section>
    <section><h3>외부 공개 링크</h3>
      {!share ? <p>불러오는 중…</p> : share.canLink ? <>
        <p>로그인 없이 누구나 이 문서를 읽을 수 있습니다. 첨부한 이미지는 사내에서만 보입니다. 주소는 만들 때 한 번만 보여 드립니다.</p>
        <div className="kw-share-row"><select aria-label="링크 유효 기간" value={days} onChange={e => setDays(Number(e.target.value) as 1 | 7 | 30)}><option value={1}>1일 동안</option><option value={7}>7일 동안</option><option value={30}>30일 동안</option></select>
          <button disabled={busy} onClick={() => void run({ action: "link", days }, result => { setCreated(result.url ?? ""); notify("외부 공개 링크를 만들었습니다"); })}>링크 만들기</button></div>
        {created && <CopyField label="새 외부 공개 링크" value={created} onCopied={copied("외부 공개 링크")} />}
        {live.length ? <ul className="kw-share-links">{live.map(link => <li key={link.id}><span>{name(link.createdBy)} · {kstTime(link.expiresAt)}까지</span>
          <button className="kw-danger" disabled={busy} onClick={() => void run({ action: "revoke", linkId: link.id }, () => { setCreated(""); notify("링크를 해제했습니다"); })}>해제</button></li>)}</ul>
          : <small>사용 중인 외부 링크가 없습니다.</small>}
      </> : <p>{doc.status === "canonical" && doc.reader_scope !== "all" ? "열람 범위가 정해진 정본은 관리자만 외부 링크를 만들 수 있습니다." : "외부 공개 링크는 작성자나 관리자만 만들 수 있습니다."}</p>}</section>
    {error && <p className="kw-error" role="alert">{error}</p>}
  </div></Modal>;
}
