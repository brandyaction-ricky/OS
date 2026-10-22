"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { documentHref, kstTime } from "@/lib/knowledge/model";
import type { KnowledgeDocument } from "@/lib/types";
import { useKnowledge } from "./provider";
import { Modal } from "./ui";

type Link = { id: string; createdBy: string; createdAt: string; expiresAt: string; revokedAt: string | null };
type Share = { canShareNote: boolean; canLink: boolean; readerIds: string[]; links: Link[] };

// Three ways to share one document: the internal address, read-only sharing of a personal note
// with named staff, and an external link anyone can open until it expires or is revoked.
export function DocumentShareDialog({ document: doc, close }: { document: KnowledgeDocument; close: () => void }) {
  const { state, actor, token, notify } = useKnowledge();
  const [share, setShare] = useState<Share | null>(null), [readers, setReaders] = useState<string[]>([]);
  const [days, setDays] = useState<1 | 7 | 30>(7), [created, setCreated] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const internal = typeof window === "undefined" ? "" : `${window.location.origin}${documentHref(doc)}`;
  const staff = state.people.filter(p => p.member_kind !== "partner" && p.id !== actor.ownerId);
  const name = (id: string) => state.people.find(p => p.id === id)?.display_name ?? "구성원";
  const load = useCallback(async () => {
    try { const result = await apiRequest<Share>(`/api/v1/documents/share?documentId=${doc.id}`, { token }); setShare(result); setReaders(result.readerIds); }
    catch (e) { setError((e as Error).message); }
  }, [doc.id, token]);
  useEffect(() => { void load(); }, [load]);
  const copy = async (text: string, label: string) => { try { await navigator.clipboard.writeText(text); notify(`${label}를 복사했습니다`); } catch { setError("복사하지 못했습니다. 주소를 직접 선택해 복사해 주세요."); } };
  const run = async (body: Record<string, unknown>, done: (result: { url?: string }) => void) => {
    setBusy(true); setError("");
    try { done(await apiRequest(`/api/v1/documents/share`, { method: "POST", token, body: JSON.stringify({ documentId: doc.id, ...body }) })); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const live = (share?.links ?? []).filter(link => !link.revokedAt && Date.parse(link.expiresAt) > Date.now());
  return <Modal title="공유·링크" onClose={close} busy={busy}><div className="kw-modal-body">
    <section><h3>사내 링크</h3><p>열람 권한이 있는 직원만 열 수 있습니다.</p>
      <div className="kw-actions"><input aria-label="사내 링크" readOnly value={internal} onFocus={e => e.currentTarget.select()} /><button onClick={() => void copy(internal, "사내 링크")}>복사</button></div></section>
    <section><h3>특정 직원에게 공유</h3>
      {!share ? <p>불러오는 중…</p> : share.canShareNote ? <>
        <p>고른 직원은 이 노트를 읽기만 할 수 있습니다. 언제든 해제할 수 있습니다.</p>
        <div className="kw-stack" style={{ maxHeight: 220, overflowY: "auto" }}>{staff.map(p => <label key={p.id}><input type="checkbox" checked={readers.includes(p.id)} onChange={e => setReaders(e.target.checked ? [...readers, p.id] : readers.filter(id => id !== p.id))} />{p.display_name}</label>)}</div>
        <div className="kw-actions"><small>{readers.length ? `${readers.length}명 선택` : "공유 안 함"}</small><button className="kw-primary" disabled={busy} onClick={() => void run({ action: "readers", readerIds: readers }, () => notify(readers.length ? `${readers.length}명에게 공유했습니다` : "공유를 해제했습니다"))}>저장</button></div>
      </> : <p>{doc.status === "draft" ? "작성자만 직원에게 공유할 수 있습니다." : doc.status === "canonical" ? "회사 정본의 열람 범위는 관리자가 ‘열람 범위’에서 정합니다." : "팀 문서는 이미 모든 직원이 볼 수 있습니다."}</p>}</section>
    <section><h3>외부 공개 링크</h3>
      {!share ? <p>불러오는 중…</p> : share.canLink ? <>
        <p>로그인 없이 누구나 이 문서를 읽을 수 있습니다. 첨부한 이미지는 사내에서만 보입니다. 주소는 만들 때 한 번만 보여 드립니다.</p>
        <div className="kw-actions"><select aria-label="링크 유효 기간" value={days} onChange={e => setDays(Number(e.target.value) as 1 | 7 | 30)}><option value={1}>1일</option><option value={7}>7일</option><option value={30}>30일</option></select>
          <button disabled={busy} onClick={() => void run({ action: "link", days }, result => { setCreated(result.url ?? ""); notify("외부 공개 링크를 만들었습니다"); })}>링크 만들기</button></div>
        {created && <div className="kw-actions"><input aria-label="새 외부 공개 링크" readOnly value={created} onFocus={e => e.currentTarget.select()} /><button onClick={() => void copy(created, "외부 공개 링크")}>복사</button></div>}
        {live.length ? live.map(link => <div className="kw-actions" key={link.id}><small>{name(link.createdBy)} · {kstTime(link.createdAt)} 생성 · {kstTime(link.expiresAt)} 만료</small>
          <button className="kw-danger" disabled={busy} onClick={() => void run({ action: "revoke", linkId: link.id }, () => { setCreated(""); notify("링크를 해제했습니다"); })}>해제</button></div>) : <small>사용 중인 외부 링크가 없습니다.</small>}
      </> : <p>{doc.status === "canonical" && doc.reader_scope !== "all" ? "열람 범위가 정해진 정본은 관리자만 외부 링크를 만들 수 있습니다." : "외부 공개 링크는 작성자나 관리자만 만들 수 있습니다."}</p>}</section>
    {error && <p className="kw-error" role="alert">{error}</p>}
  </div></Modal>;
}
